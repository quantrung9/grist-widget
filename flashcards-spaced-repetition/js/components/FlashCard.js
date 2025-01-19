export default {
  template: `
    <div class="card-container">
      <div v-if="currentCard" class="card">
        <div class="question">{{ currentCard.fields.Question }}</div>
        <div v-show="showAnswer" class="answer">{{ currentCard.fields.Answer }}</div>
        
        <button v-if="!showAnswer" @click="revealAnswer">Show Answer</button>
        
        <div v-show="showAnswer" class="grade-buttons">
          <button @click="gradeCard('again')">Again</button>
          <button @click="gradeCard('hard')">Hard</button>
          <button @click="gradeCard('good')">Good</button>
          <button @click="gradeCard('easy')">Easy</button>
        </div>
      </div>
      <div v-else>
        <p>No cards due for review!</p>
      </div>
      <button @click="loadCards">Reload</button>
    </div>
  `,
  data() {
    return {
      currentCard: null,
      showAnswer: false,
      columnMappings: null
    }
  },
  methods: {
    async loadCards() {
      try {
        // Get widget's column mappings
        const cols = await grist.getSelectedTable().getViewFields();
        this.columnMappings = grist.mapColumnNames(cols);
        
        if (!this.columnMappings || !this.columnMappings.DueDate) {
          console.error('No due date column mapped');
          return;
        }
        
        const tokenInfo = await grist.docApi.getAccessToken({readOnly: true});
        const tableId = await grist.getSelectedTableId();
        const now = Math.floor(Date.now() / 1000);
        
        const requestBody = {
          sql: `SELECT * FROM ${tableId} 
                WHERE (${this.columnMappings.DueDate} <= ? OR ${this.columnMappings.DueDate} IS NULL)
                ORDER BY ${this.columnMappings.DueDate} ASC
                LIMIT 1`,
          args: [now]
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
        
        if (data.records.length === 0) {
          this.currentCard = null;
          return;
        }

        this.currentCard = {
          ...data.records[0],
          tableRef: tableId
        };
        this.showAnswer = false;

      } catch (err) {
        console.error('Error loading cards:', err);
        this.currentCard = null;
      }
    },

    revealAnswer() {
      this.showAnswer = true;
    },

    async gradeCard(difficulty) {
      if (!this.currentCard) return;
      
      const now = new Date();
      const nextDue = Math.floor(now.getTime() / 1000) + (
        difficulty === 'again' ? 60 :    // 1 minute
        difficulty === 'hard' ? 300 :    // 5 minutes
        difficulty === 'good' ? 600 :    // 10 minutes
        86400                           // 1 day (easy)
      );
      
      try {
        // Update due date using widget's column mapping
        await grist.docApi.applyUserActions([['UpdateRecord', this.currentCard.tableRef, this.currentCard.fields.id, {
          [this.columnMappings.DueDate]: nextDue
        }]]);

        // Get review log mappings for logging the review
        const reviewLogTable = await grist.getOption('reviewLogTable');
        const reviewMappings = await grist.getOption('columnMappings');
        
        if (reviewLogTable && reviewMappings) {
          const reviewRecord = {
            [reviewMappings.cardIdColumn]: this.currentCard.fields.id,
            [reviewMappings.reviewDateColumn]: Math.floor(now.getTime() / 1000),
            [reviewMappings.difficultyColumn]: difficulty,
            [reviewMappings.nextDueColumn]: nextDue
          };
          
          await grist.docApi.applyUserActions([['AddRecord', reviewLogTable, null, reviewRecord]]);
        }

        this.currentCard = null;
        this.showAnswer = false;
        await this.loadCards();
      } catch (err) {
        console.error('Error updating card:', err);
        alert('Failed to save review. Please try again.');
      }
    }
  },
  async mounted() {
    await this.loadCards();
  }
}
