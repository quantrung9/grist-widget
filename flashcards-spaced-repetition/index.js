function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

let dueDateColumn;
let currentCard = null;

ready(async function() {
  // Initialize Grist API
  grist.ready({
    hasCustomOptions: true,
    columns: [
      { name: "Question", type: 'Text', title: "Question Column"},
      { name: "Answer", type: 'Text', title: "Answer Column"},
      { name: "DueDate", type: 'DateTime', title: "Due Date"}
    ],
    requiredAccess: 'full',
    onEditOptions: async function() {
      const tables = await grist.docApi.listTables();
      const currentLogTable = await grist.getOption('reviewLogTable') || '';
      
      const select = document.getElementById('reviewLogSelect');
      select.innerHTML = `
        <option value="">-- None --</option>
        ${tables.map(tableName => 
          `<option value="${tableName}" ${tableName === currentLogTable ? 'selected' : ''}>
            ${tableName}
          </option>`
        ).join('')}
      `;

      showPanel('configuration');
    }
  });

  let hasLoadedCards = false;
  
  // Move configuration panel handlers inside ready function
  document.getElementById('saveConfig').addEventListener('click', async () => {
    const selectedTable = document.getElementById('reviewLogSelect').value;
    await grist.setOption('reviewLogTable', selectedTable);
    showPanel('editor');
  });

  document.getElementById('cancelConfig').addEventListener('click', () => {
    showPanel('editor');
  });

  // Update onRecord to remove reviewLogTableId assignment
  grist.onRecord(async function (record, mappings) {
    const mapped = grist.mapColumnNames(record);
    if (mapped && !hasLoadedCards) {
      dueDateColumn = mappings.DueDate;
      loadCards(dueDateColumn);
      hasLoadedCards = true;
    }
  });

  // Add reload button handler
  document.getElementById('reloadBtn').addEventListener('click', () => loadCards(dueDateColumn));

  document.getElementById('showAnswerBtn').addEventListener('click', () => {
    document.querySelector('.answer').style.display = 'block';
    document.getElementById('gradeButtons').style.display = 'block';
    document.getElementById('showAnswerBtn').style.display = 'none';
  });

  const gradeCard = async (difficulty) => {
    if (!currentCard) return;
    
    const now = new Date();
    const nextDue = Math.floor(now.getTime() / 1000) + (
      difficulty === 'again' ? 60 :          // 1 minute
      difficulty === 'hard' ? 300 :          // 5 minutes
      difficulty === 'good' ? 600 :          // 10 minutes
      86400                                  // 1 day (easy)
    );
    
    try {
      // Uncomment and fix the update action
      await grist.docApi.applyUserActions([['UpdateRecord', currentCard.tableRef, currentCard.fields.id, {
        [dueDateColumn]: nextDue
      }]]);

      // Get reviewLogTable directly from options when needed
      const reviewLogTable = await grist.getOption('reviewLogTable');
      if (reviewLogTable) {
        await grist.docApi.applyUserActions([['AddRecord', reviewLogTable, null, {
          card_id: currentCard.fields.id,
          review_date: Math.floor(now.getTime() / 1000),
          difficulty: difficulty,
          next_due: nextDue
        }]]);
      }

      // Reset current card
      currentCard = null;

      // Reset UI state
      document.querySelector('.answer').style.display = 'none';
      document.getElementById('showAnswerBtn').style.display = 'block';
      document.getElementById('gradeButtons').style.display = 'none';
      
      // Load next card after the update is complete
      await loadCards(dueDateColumn);
    } catch (err) {
      console.error('Error updating card:', err);
    }
  };

  document.getElementById('againBtn').addEventListener('click', () => gradeCard('again'));
  document.getElementById('hardBtn').addEventListener('click', () => gradeCard('hard'));
  document.getElementById('goodBtn').addEventListener('click', () => gradeCard('good'));
  document.getElementById('easyBtn').addEventListener('click', () => gradeCard('easy'));
});

async function loadCards(dueDateColumn) {
  try {
    const tokenInfo = await grist.docApi.getAccessToken({readOnly: true});
    const tableId = await grist.getSelectedTableId();
    const now = Math.floor(Date.now() / 1000);
    
    const requestBody = {
      sql: `SELECT * FROM ${tableId} 
            WHERE (${dueDateColumn} <= ? OR ${dueDateColumn} IS NULL)
            ORDER BY ${dueDateColumn} ASC
            LIMIT 1`,  // Changed to LIMIT 1 and ASC order
      args: [now]  // Args as an array, with timestamp as first element
    };

    const response = await fetch(`${tokenInfo.baseUrl}/sql?auth=${tokenInfo.token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error('Failed to fetch flashcards');
    }

    const data = await response.json();
    
    const container = document.getElementById('card-container');
    const controls = document.getElementById('controls');
    const gradeButtons = document.getElementById('gradeButtons');
    const showAnswerBtn = document.getElementById('showAnswerBtn');
    
    container.innerHTML = '';
    
    if (data.records.length === 0) {
      container.innerHTML = '<p>No cards due for review!</p>';
      controls.style.display = 'none';
      return;
    }

    // Reset UI state
    controls.style.display = 'block';
    showAnswerBtn.style.display = 'block';
    gradeButtons.style.display = 'none';

    currentCard = {
      ...data.records[0],
      tableRef: tableId
    };
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.innerHTML = `
      <div class="question">${currentCard.fields.Question}</div>
      <div class="answer" style="display: none">${currentCard.fields.Answer}</div>
    `;
    container.appendChild(cardDiv);
  } catch (err) {
    console.error('Error loading cards:', err);
  }
}

function showPanel(name) {
  document.getElementById("configuration").style.display = 'none';
  document.getElementById("editor").style.display = 'none';
  document.getElementById(name).style.display = '';
}
