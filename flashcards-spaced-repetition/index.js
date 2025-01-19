function ready(fn) {
  if (document.readyState !== 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

let dueDateColumn; // Declare at top level scope

ready(async function() {
  // Initialize Grist API
  grist.ready({
    columns: [
      { name: "Question", type: 'Text', title: "Question Column"},
      { name: "Answer", type: 'Text', title: "Answer Column"},
      { name: "DueDate", type: 'DateTime', title: "Due Date"}
    ],
    requiredAccess: 'read table',
    allowSelectBy: true  // Added this line
  });

  let hasLoadedCards = false; // Add this at the top level
  
  grist.onRecord(function (record, mappings) {
    const mapped = grist.mapColumnNames(record);
    if (mapped && !hasLoadedCards) {
      dueDateColumn = mappings.DueDate;
      loadCards(dueDateColumn);
      hasLoadedCards = true;
    }
  });

  // Add reload button handler
  document.getElementById('reloadBtn').addEventListener('click', () => loadCards(dueDateColumn));
});

async function loadCards(dueDateColumn) {
  try {
    const tokenInfo = await grist.docApi.getAccessToken({readOnly: true});
    const tableId = await grist.getSelectedTableId();
    const now = Math.floor(Date.now() / 1000);
    
    const requestBody = {
      sql: `SELECT * FROM ${tableId} WHERE ${dueDateColumn} <= ? OR ${dueDateColumn} IS NULL ORDER BY ${dueDateColumn} DESC LIMIT 10`,  // Changed DueDate to dueDateColumn
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
    console.log('Fetched filtered table data:', data);
    
    const container = document.getElementById('card-container');
    container.innerHTML = '';
    
    // Handle the new response format
    data.records.forEach(record => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'card';
      cardDiv.innerHTML = `
        <div class="question">${record.fields.Question}</div>
        <div class="answer">${record.fields.Answer}</div>
      `;
      container.appendChild(cardDiv);
    });
  } catch (err) {
    console.error('Error loading cards:', err);
  }
}
