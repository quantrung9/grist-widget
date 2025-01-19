export default {
  template: `
    <div class="config-panel">
      <h3>Configuration</h3>
      <div class="form-group">
        <label>Review Log Table:</label>
        <select v-model="selectedTable" @change="onTableChange">
          <option value="">-- Select Review Log Table --</option>
          <option v-for="table in tables" :key="table" :value="table">
            {{ table }}
          </option>
        </select>
      </div>
      
      <div id="columnMappings">
        <div v-for="mapping in columnMappings" :key="mapping.id" class="mapping-row">
          <label :title="mapping.description">{{ mapping.label }}:</label>
          <select v-model="mappings[mapping.field]">
            <option value="">-- Select Column --</option>
            <option v-for="col in columns" :key="col.id" :value="col.id">
              {{ col.fields.label || col.id }}
            </option>
          </select>
        </div>
      </div>
      
      <div class="button-group">
        <button @click="save">Save</button>
        <button @click="cancel">Cancel</button>
      </div>
    </div>
  `,
  data() {
    return {
      // ...existing data...
    }
  },
  methods: {
    // ...existing methods...
  },
  mounted() {
    this.loadTables()
  }
}
