import FlashCard from './components/FlashCard.js'
import ConfigPanel from './components/ConfigPanel.js'

const app = Vue.createApp({
  components: {
    FlashCard,
    ConfigPanel
  },
  data() {
    return {
      showConfig: false
    }
  },
  template: `
    <FlashCard v-if="!showConfig" />
    <ConfigPanel 
      v-else 
      @saved="showConfig = false"
      @cancelled="showConfig = false"
    />
  `,
  async mounted() {
    await grist.ready({
      hasCustomOptions: true,
      columns: [
        { name: "Question", type: 'Text', title: "Question Column"},
        { name: "Answer", type: 'Text', title: "Answer Column"},
        { name: "DueDate", type: 'DateTime', title: "Due Date"}
      ],
      requiredAccess: 'full',
      onEditOptions: () => {
        this.showConfig = true
      }
    })

    // Check if configuration is needed
    const reviewLogTable = await grist.getOption('reviewLogTable')
    const savedMappings = await grist.getOption('columnMappings')
    
    if (!reviewLogTable || !savedMappings || Object.keys(savedMappings).length === 0) {
      this.showConfig = true
    }
  }
})

app.mount('#app')
