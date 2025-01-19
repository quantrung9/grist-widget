function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

let dueDateColumn;
let currentCard = null;

// Update columnMappings at the top level
const columnMappings = [
  { id: 'flashcardId', label: 'Flashcard ID', field: 'flashcardIdColumn', description: 'Reference to the flashcard' },
  { id: 'reviewedAt', label: 'Reviewed At', field: 'reviewedAtColumn', description: 'When the review occurred' },
  { id: 'rating', label: 'Rating', field: 'ratingColumn', description: 'User rating of the flashcard' },
  { id: 'state', label: 'State', field: 'stateColumn', description: 'FSRS state' },
  { id: 'due', label: 'Due Date', field: 'dueColumn', description: 'Next review date' },
  { id: 'stability', label: 'Stability', field: 'stabilityColumn', description: 'FSRS stability' },
  { id: 'difficulty', label: 'Difficulty', field: 'difficultyColumn', description: 'FSRS difficulty' },
  { id: 'elapsedDays', label: 'Elapsed Days', field: 'elapsedDaysColumn', description: 'Days since last review' },
  { id: 'scheduledDays', label: 'Scheduled Days', field: 'scheduledDaysColumn', description: 'Days until next review' },
  { id: 'lastElapsedDays', label: 'Last Elapsed Days', field: 'lastElapsedDaysColumn', description: 'Number of days between the last two reviews' }
];

ready(async function() {
  try {
    // Initialize Grist API
    await grist.ready({
      hasCustomOptions: true,
      columns: [
        { name: "Question", type: 'Text', title: "Question Column"},
        { name: "Answer", type: 'Text', title: "Answer Column"},
        { name: "DueDate", type: 'DateTime', title: "Due Date"}
      ],
      requiredAccess: 'full',
      onEditOptions: async function() {
        await showConfigurationPanel();
      }
    });

    // Show editor panel by default
    showPanel('editor');

    // Check if reviewLogTable is set
    const reviewLogTable = await grist.getOption('reviewLogTable');
    const savedMappings = await grist.getOption('columnMappings') || {};
    
    console.log('Initial load:', { reviewLogTable, savedMappings });
    
    if (!reviewLogTable || !savedMappings || Object.keys(savedMappings).length === 0) {
      console.log('No configuration found, showing config panel');
      await showConfigurationPanel();
      return;
    }

    // Set dueDateColumn from saved mappings
    if (savedMappings.nextDueColumn) {
      dueDateColumn = savedMappings.nextDueColumn;
      await loadCards(dueDateColumn);
    }

    let hasLoadedCards = false;
    
    // Move configuration panel handlers inside ready function
    document.getElementById('cancelConfig').addEventListener('click', () => {
      showPanel('editor');
    });

    // Update onRecord to remove reviewLogTableId assignment
    grist.onRecord(async function (record, mappings) {
      const mapped = grist.mapColumnNames(record);
      if (mapped && !hasLoadedCards) {
        try {
          const savedMappings = await grist.getOption('columnMappings');
          if (savedMappings && savedMappings.dueColumn) {
            dueDateColumn = savedMappings.dueColumn;
            await loadCards(dueDateColumn);
            hasLoadedCards = true;
          }
        } catch (error) {
          console.error('Error loading saved mappings:', error);
        }
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
        // Get saved mappings
        const savedMappings = await grist.getOption('columnMappings');
        if (!savedMappings) {
          throw new Error('No column mappings found');
        }

        // Update the card's due date
        await grist.docApi.applyUserActions([['UpdateRecord', currentCard.tableRef, currentCard.fields.id, {
          [dueDateColumn]: nextDue
        }]]);

        // Get reviewLogTable and add review record using mapped column names
        const reviewLogTable = await grist.getOption('reviewLogTable');
        if (reviewLogTable) {
          const reviewRecord = {
            [savedMappings.cardIdColumn]: currentCard.fields.id,
            [savedMappings.reviewDateColumn]: Math.floor(now.getTime() / 1000),
            [savedMappings.difficultyColumn]: difficulty,
            [savedMappings.nextDueColumn]: nextDue
          };

          console.log('Adding review record:', reviewRecord); // Debug log
          
          await grist.docApi.applyUserActions([['AddRecord', reviewLogTable, null, reviewRecord]]);
        }

        // Reset current card and UI state
        currentCard = null;
        document.querySelector('.answer').style.display = 'none';
        document.getElementById('showAnswerBtn').style.display = 'block';
        document.getElementById('gradeButtons').style.display = 'none';
        
        // Load next card
        await loadCards(dueDateColumn);
      } catch (err) {
        console.error('Error updating card:', err);
        alert('Failed to save review. Please try again.');
      }
    };

    document.getElementById('againBtn').addEventListener('click', () => gradeCard('again'));
    document.getElementById('hardBtn').addEventListener('click', () => gradeCard('hard'));
    document.getElementById('goodBtn').addEventListener('click', () => gradeCard('good'));
    document.getElementById('easyBtn').addEventListener('click', () => gradeCard('easy'));
  } catch (error) {
    console.error('Error during initialization:', error);
    document.getElementById('card-container').innerHTML = '<p>Error loading widget. Please check console for details.</p>';
  }
});

async function loadCards(dueDateColumn) {
  try {
    // Add check for dueDateColumn
    if (!dueDateColumn) {
      console.error('No due date column configured');
      document.getElementById('card-container').innerHTML = `
        <p>Please configure the due date column in settings.</p>
        <button onclick="showConfigurationPanel()">Open Settings</button>
      `;
      return;
    }
    
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
    document.getElementById('card-container').innerHTML = `
      <p>Error loading cards. Please try again.</p>
      <button onclick="loadCards('${dueDateColumn}')">Retry</button>
    `;
  }
}

async function showConfigurationPanel() {
  const tokenInfo = await grist.docApi.getAccessToken({readOnly: true});
  const tables = await grist.docApi.listTables();
  const currentLogTable = await grist.getOption('reviewLogTable') || '';
  const currentTable = await grist.getSelectedTableId();
  const savedMappings = await grist.getOption('columnMappings') || {};
  
  console.log('Loading configuration with saved mappings:', savedMappings); // Debug log
  
  // Set up table select
  const select = document.getElementById('reviewLogSelect');
  select.innerHTML = `
    <option value="">-- Select Review Log Table --</option>
    ${tables
      .filter(tableName => tableName !== currentTable)
      .map(tableName => 
        `<option value="${tableName}" ${tableName === currentLogTable ? 'selected' : ''}>
          ${tableName}
        </option>`
      ).join('')}
  `;

  // Force select the saved table
  if (currentLogTable) {
    select.value = currentLogTable;
    
    try {
      const columnsUrl = `${tokenInfo.baseUrl}/tables/${currentLogTable}/columns?auth=${tokenInfo.token}`;
      const response = await fetch(columnsUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch columns: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Fetched columns for saved table:', data.columns);
      
      // First update the selectors
      updateColumnMappingSelectors(data.columns, columnMappings, savedMappings);
      
      // Then restore saved values with a slight delay to ensure DOM is ready
      setTimeout(() => {
        columnMappings.forEach(mapping => {
          const select = document.getElementById(mapping.field);
          const savedValue = savedMappings[mapping.field];
          if (select && savedValue) {
            select.value = savedValue;
            console.log(`Restored ${mapping.field} to ${savedValue}`);
          } else {
            console.log(`Could not restore ${mapping.field}, saved value: ${savedValue}`);
          }
        });
      }, 0);
    } catch (error) {
      console.error('Error loading saved configuration:', error);
    }
  }

  // Remove duplicate mappingContainer.innerHTML = '' since it's handled in updateColumnMappingSelectors
  
  // Add table change handler
  select.addEventListener('change', async () => {
    const selectedTable = select.value;
    if (selectedTable) {
      try {
        const columnsUrl = `${tokenInfo.baseUrl}/tables/${selectedTable}/columns?auth=${tokenInfo.token}`;
        const response = await fetch(columnsUrl);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch columns: ${response.statusText}`);
        }

        const data = await response.json();
        // When changing tables, don't pass savedMappings to allow fresh selection
        updateColumnMappingSelectors(data.columns, columnMappings, {});
      } catch (error) {
        console.error('Error fetching columns:', error);
        alert('Failed to fetch columns. Please try again.');
      }
    }
  });

  showPanel('configuration');
}

// Update the updateColumnMappingSelectors function to be more robust
function updateColumnMappingSelectors(columns, mappings, savedMappings) {
  const container = document.getElementById('columnMappings');
  if (!container) return; // Guard against missing container
  
  container.innerHTML = mappings.map(mapping => `
    <div class="mapping-row">
      <label title="${mapping.description}">${mapping.label}:</label>
      <select id="${mapping.field}" data-field="${mapping.field}">
        <option value="">-- Select Column --</option>
        ${columns.map(col => {
          const savedValue = savedMappings[mapping.field];
          const isSelected = savedValue === col.id;
          return `
            <option value="${col.id}" ${isSelected ? 'selected' : ''}>
              ${col.fields.label || col.id}
            </option>
          `;
        }).join('')}
      </select>
    </div>
  `).join('');
}

function showPanel(name) {
  document.getElementById("configuration").style.display = 'none';
  document.getElementById("editor").style.display = 'none';
  document.getElementById(name).style.display = '';
}

// Make showConfigurationPanel available globally
window.showConfigurationPanel = showConfigurationPanel;
window.loadCards = loadCards;
