function ready(fn) {
  if (document.readyState !== 'loading'){
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

let questions = null;
let at = 0;
let state = 'Q';  // Can be 'Q' when question is shown, or 'A' when answer is shown.
let isShuffled = false;
let sourceRecords = [];

const ui = {
  questionCard: null,
  answerCard: null,
  showBtn: null,
  nextBtn: null,
  backBtn: null,
  restartBtn: null,
  shuffleBtn: null,
  progressBarFilled: null,
  progressText: null,
  questionAudio: null,
  answerAudio: null,
  questionError: null,
  answerError: null,
  questionAudioControls: null,
  answerAudioControls: null,
  questionLoopCheckbox: null,
  answerLoopCheckbox: null,
};

function getAnswerHTML(answer) {
  if (!Array.isArray(answer)) {
    return answer;
  }
  return "<ul>\n" +
    answer.map(v => `<li>${v}</li>`).join('\n') +
    "</ul>";
}

function goNext(step) {
  if (questions.length === 0) { return; }
  if (step === 'start') {
    at = 0;
  } else {
    at += step;
    if (at < 0) { at = 0; }
  }
  at = at % questions.length;
  ui.progressBarFilled.style.width = (at * 100 / questions.length) + "%";
  ui.progressText.textContent = (at + 1) + " of " + questions.length;
  const qa = questions[at];
  
  store.set('flashcards-rowid', qa.id);
  ui.questionCard.innerHTML = qa.Question;
  ui.answerCard.innerHTML = getAnswerHTML(qa.Answer);

  // Initialize audio players with error elements and controls
  initAudioPlayer(
    ui.questionAudio,
    qa.QuestionAudioURL,
    qa.QuestionStartTime,
    qa.QuestionEndTime,
    ui.questionError,
    ui.questionAudioControls,
    ui.questionLoopCheckbox,
    true  // autoplay for question
  );
  
  initAudioPlayer(
    ui.answerAudio,
    qa.AnswerAudioURL,
    qa.AnswerStartTime,
    qa.AnswerEndTime,
    ui.answerError,
    ui.answerAudioControls,
    ui.answerLoopCheckbox,
    false  // don't autoplay answer yet
  );

  setState('Q');
}

function goShow() {
  setState('A');
  ui.progressBarFilled.style.width = ((at + 1) * 100 / questions.length) + "%";
  
  // Auto-play answer audio when showing answer
  if (ui.answerAudio.src) {
    ui.answerAudio.currentTime = 0;
    ui.answerAudio.play().catch(error => {
      console.warn('Auto-play failed:', error);
    });
  }
}

function setState(nextState) {
  state = nextState;
  show(ui.answerCard, state === 'A');
  
  // Show/hide answer audio controls only when answer is revealed and has a source
  if (state === 'A' && ui.answerAudio.getAttribute('src')) {
    ui.answerAudioControls.style.display = 'block';
    ui.answerAudio.style.display = 'block';
  } else {
    ui.answerAudioControls.style.display = 'none';
    ui.answerAudio.style.display = 'none';
  }
  
  show(ui.showBtn, state === 'Q');
  show(ui.nextBtn, state === 'A');
}

function shuffleCards(yesNo) {
  if (yesNo !== null) {
    isShuffled = yesNo;
  } else {
    isShuffled = !isShuffled;
  }
  if (isShuffled) {
    questions = sourceRecords.map(val => [Math.random(), val])
      .sort((a, b) => a[0] - b[0])
      .map(a => a[1]);
  } else {
    questions = sourceRecords;
  }
  ui.shuffleBtn.classList.toggle("disabled", !isShuffled)
}

function initAudioPlayer(audioElement, url, startTime, endTime, errorElement, controlsElement, loopCheckbox, autoplay) {
  // Clear previous errors and hide everything initially
  errorElement.textContent = '';
  errorElement.style.display = 'none';
  controlsElement.style.display = 'none';
  audioElement.style.display = 'none';
  loopCheckbox.parentElement.parentElement.style.display = 'none';
  
  // If no URL is provided, just return early
  if (!url) {
    audioElement.removeAttribute('src'); // Remove src completely instead of setting to empty
    loopCheckbox.checked = false;
    return;
  }

  try {
    // Set the audio source
    audioElement.src = url;
    
    // Convert times from milliseconds to seconds
    const startSec = startTime ? startTime / 1000 : 0;
    const endSec = endTime ? endTime / 1000 : null;
    
    // Validate time values
    if (endSec !== null && startSec >= endSec) {
      throw new Error(`Invalid time range: Start time (${startTime}ms) must be less than end time (${endTime}ms)`);
    }

    if (startTime < 0) {
      throw new Error('Start time cannot be negative');
    }

    if (endTime !== null && endTime < 0) {
      throw new Error('End time cannot be negative');
    }

    // Show controls based on whether it's answer audio and current state
    if (audioElement === ui.answerAudio) {
      if (state === 'A') {
        controlsElement.style.display = 'block';
        audioElement.style.display = 'block';
        loopCheckbox.parentElement.parentElement.style.display = 'block';
      }
    } else {
      controlsElement.style.display = 'block';
      audioElement.style.display = 'block';
      loopCheckbox.parentElement.parentElement.style.display = 'block';
    }
    
    audioElement.currentTime = startSec;

    // Remove any existing timeupdate handler
    audioElement.removeEventListener('timeupdate', audioElement._timeUpdateHandler);
    
    // Add timeupdate handler for end time
    audioElement._timeUpdateHandler = () => {
      if (endSec !== null && audioElement.currentTime >= endSec) {
        if (loopCheckbox.checked) {
          audioElement.currentTime = startSec;
          audioElement.play().catch(error => {
            console.warn('Auto-play failed:', error);
          });
        } else {
          audioElement.pause();
          audioElement.currentTime = startSec;
        }
      }
    };

    audioElement.addEventListener('timeupdate', audioElement._timeUpdateHandler);

    // Auto-play if requested
    if (autoplay) {
      audioElement.play().catch(error => {
        console.warn('Auto-play failed:', error);
      });
    }

    // Handle loading errors - only for non-empty URLs
    audioElement.onerror = function() {
      if (!audioElement.getAttribute('src')) return; // Don't show errors if no src
      
      const errorMessage = `Error loading audio from: ${url}`;
      console.error(errorMessage, audioElement.error);
      
      if (audioElement.error) {
        switch (audioElement.error.code) {
          case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
            errorElement.innerHTML = `Cannot play audio file. This may be because:<br><br>
1. The time range is invalid (start time must be less than end time)<br>
2. The audio format is not supported<br>
3. The file is blocked by CORS policy<br>
4. The file requires authentication<br>
5. The file doesn't exist`;
            break;
          case 1:
            errorElement.textContent = `${errorMessage} (Playback was aborted)`;
            break;
          case 2:
            errorElement.textContent = `${errorMessage} (Network error)`;
            break;
          case 3:
            errorElement.textContent = `${errorMessage} (Audio decoding failed)`;
            break;
          default:
            errorElement.textContent = errorMessage;
        }
        errorElement.style.display = 'block';
      }
    };

    // Handle metadata loaded to validate duration
    audioElement.onloadedmetadata = function() {
      if (!url) return; // Don't validate duration for empty URLs
      
      const durationSec = audioElement.duration;
      if (startSec > durationSec || (endSec !== null && endSec > durationSec)) {
        const error = `Invalid time range: Audio duration is ${Math.round(durationSec * 1000)}ms, but ${
          startSec > durationSec ? `start time is ${startTime}ms` : `end time is ${endTime}ms`
        }`;
        errorElement.textContent = error;
        errorElement.style.display = 'block';
        audioElement.pause();
      }
    };

  } catch (err) {
    if (!audioElement.getAttribute('src')) return; // Don't show errors if no src
    
    errorElement.textContent = `Error: ${err.message}`;
    errorElement.style.display = 'block';
  }
}

ready(function() {
  ui.questionCard = document.getElementById('question');
  ui.answerCard = document.getElementById('answer');
  ui.showBtn = document.getElementById('show');
  ui.nextBtn = document.getElementById('next');
  ui.backBtn = document.getElementById('back');
  ui.restartBtn = document.getElementById('restart');
  ui.shuffleBtn = document.getElementById('shuffle');
  ui.progressBarFilled = document.getElementById('progress-bar-filled');
  ui.progressText = document.getElementById('progress-text');
  ui.questionAudio = document.getElementById('questionAudio');
  ui.answerAudio = document.getElementById('answerAudio');
  ui.questionError = document.getElementById('questionError');
  ui.answerError = document.getElementById('answerError');
  ui.questionAudioControls = document.getElementById('questionAudioControls');
  ui.answerAudioControls = document.getElementById('answerAudioControls');
  ui.questionLoopCheckbox = document.getElementById('questionLoopCheckbox');
  ui.answerLoopCheckbox = document.getElementById('answerLoopCheckbox');
  grist.ready({
    columns: [
      { name: "Question", type: 'Text', title: "Question Column"},
      { name: "Answer", type: 'Text', title: "Answer Column"},
      { name: "QuestionAudioURL", type: 'Text', title: "Question Audio URL", optional: true},
      { name: "QuestionStartTime", type: 'Numeric', title: "Question Audio Start Time (ms)", optional: true},
      { name: "QuestionEndTime", type: 'Numeric', title: "Question Audio End Time (ms)", optional: true},
      { name: "AnswerAudioURL", type: 'Text', title: "Answer Audio URL", optional: true},
      { name: "AnswerStartTime", type: 'Numeric', title: "Answer Audio Start Time (ms)", optional: true},
      { name: "AnswerEndTime", type: 'Numeric', title: "Answer Audio End Time (ms)", optional: true},
    ],
    requiredAccess: 'read table'
  });
  grist.ready();
  grist.onRecords(function(records, mappings) {
    sourceRecords = grist.mapColumnNames(records, mappings);
    shuffleCards(isShuffled);
    const storedRowId = parseInt(store.get('flashcards-rowid'), 10);
    at = questions.findIndex(qa => qa.id === storedRowId);
    goNext(0);
  });
  ui.showBtn.addEventListener('click', goShow);
  ui.nextBtn.addEventListener('click', () => goNext(1));
  ui.backBtn.addEventListener('click', () => goNext(-1));
  ui.restartBtn.addEventListener('click', () => goNext('start'));
  ui.shuffleBtn.addEventListener('click', () => { shuffleCards(null); goNext('start'); });
  document.addEventListener("keydown", function(event) {
    if (event.key === " " || event.key === "Enter" || event.key === "Right" || event.key === "ArrowRight") {
      if (state === 'Q') {
        goShow();
      } else {
        goNext(1);
      }
      event.preventDefault();
    }
    if (event.key === "Left" || event.key === "ArrowLeft") {
      goNext(-1);
      event.preventDefault();
    }
    return false;
  });
  
  // Add loop checkbox handlers
  ui.questionLoopCheckbox.addEventListener('change', function() {
    if (this.checked && ui.questionAudio.paused) {
      ui.questionAudio.currentTime = ui.questionAudio.currentTime || 0;
      ui.questionAudio.play().catch(error => {
        console.warn('Auto-play failed:', error);
      });
    }
  });
  
  ui.answerLoopCheckbox.addEventListener('change', function() {
    if (this.checked && ui.answerAudio.paused) {
      ui.answerAudio.currentTime = ui.answerAudio.currentTime || 0;
      ui.answerAudio.play().catch(error => {
        console.warn('Auto-play failed:', error);
      });
    }
  });
});

function show(elem, yesNo) {
  elem.style.display = yesNo ? '' : 'none';
}
