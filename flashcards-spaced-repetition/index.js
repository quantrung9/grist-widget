function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

let dueDateColumn;
let currentCard = null;

// Add columnMappings at the top level
const columnMappings = [
  { id: 'card_id', label: 'Card ID', field: 'cardIdColumn', description: 'Reference to the flashcard', required: true },
  { id: 'review_date', label: 'Review Date', field: 'reviewDateColumn', description: 'When the review occurred', required: true },
  { id: 'difficulty', label: 'Difficulty', field: 'difficultyColumn', description: 'Review difficulty rating', required: true },
  { id: 'next_due', label: 'Next Due', field: 'nextDueColumn', description: 'Next review date', required: true }
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
  
  console.log('Loading configuration:', { currentLogTable, savedMappings }); // Debug log
  
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

  // Set up save button handler
  const saveButton = document.getElementById('saveConfig');
  if (saveButton) {
    saveButton.onclick = async () => {
      console.log('Save button clicked');
      const selectedTable = document.getElementById('reviewLogSelect').value;
      console.log('Selected table:', selectedTable);
      
      if (!selectedTable) {
        alert('Please select a review log table');
        return;
      }

      const mappings = {};
      let missingRequired = false;

      // Get values from all mapping selectors
      columnMappings.forEach(mapping => {
        const select = document.getElementById(mapping.field);
        if (select) {
          mappings[mapping.field] = select.value;
          if (mapping.required && !select.value) {
            missingRequired = true;
          }
        }
      });

      if (missingRequired) {
        alert('Please map all required fields before saving');
        return;
      }

      try {
        console.log('Saving configuration:', { selectedTable, mappings });
        await grist.setOption('reviewLogTable', selectedTable);
        await grist.setOption('columnMappings', mappings);
        
        showPanel('editor');
        
        // Update dueDateColumn and reload cards
        if (mappings.nextDueColumn) {
          dueDateColumn = mappings.nextDueColumn;
          await loadCards(dueDateColumn);
        }
      } catch (error) {
        console.error('Error saving configuration:', error);
        alert('Failed to save configuration. Please try again.');
      }
    };
  }

  // Explicitly set the saved table value
  if (currentLogTable) {
    select.value = currentLogTable;
    
    try {
      const columnsUrl = `${tokenInfo.baseUrl}/tables/${currentLogTable}/columns?auth=${tokenInfo.token}`;
      const response = await fetch(columnsUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch columns: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Fetched columns:', data.columns);
      console.log('Saved mappings:', savedMappings);
      
      // Update selectors with saved mappings
      updateColumnMappingSelectors(data.columns, columnMappings, savedMappings);
      
      // Explicitly set saved values after rendering selectors
      Object.entries(savedMappings).forEach(([field, value]) => {
        const select = document.getElementById(field);
        if (select) {
          select.value = value;
          console.log(`Setting ${field} to ${value}`);
        }
      });
    } catch (error) {
      console.error('Error loading saved configuration:', error);
    }
  }

  // Simplified column mapping configuration
  const mappingContainer = document.getElementById('columnMappings');
  mappingContainer.innerHTML = '';

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
        updateColumnMappingSelectors(data.columns, columnMappings, savedMappings);
      } catch (error) {
        console.error('Error fetching columns:', error);
        alert('Failed to fetch columns. Please try again.');
      }
    }
  });

  if (currentLogTable) {
    try {
      const columnsUrl = `${tokenInfo.baseUrl}/tables/${currentLogTable}/columns?auth=${tokenInfo.token}`;
      const response = await fetch(columnsUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch columns: ${response.statusText}`);
      }

      const data = await response.json();
      updateColumnMappingSelectors(data.columns, columnMappings, savedMappings);
    } catch (error) {
      console.error('Error fetching initial columns:', error);
    }
  }

  showPanel('configuration');
}

function updateColumnMappingSelectors(columns, mappings, savedMappings) {
  const container = document.getElementById('columnMappings');
  container.innerHTML = mappings.map(mapping => `
    <div class="mapping-row">
      <label title="${mapping.description}">${mapping.label}${mapping.required ? ' *' : ''}:</label>
      <select id="${mapping.field}" data-field="${mapping.field}">
        <option value="">-- Select Column --</option>
        ${columns.map(col => `
          <option value="${col.id}" ${savedMappings[mapping.field] === col.id ? 'selected' : ''}>
            ${col.fields.label || col.id}
          </option>
        `).join('')}
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
