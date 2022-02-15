document.head.innerHTML += `<link type="text/css" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/jsoneditor@9.7.0/dist/jsoneditor.min.css">`;

export default {
  init() {
    Vue.component('json-viewer', {
      props: ['value'],
      template: `
    <div>
      <div ref="jsoneditor" style="width: 340px; height: calc(100vh - 31px);"></div>
    </div>
      `,
      watch: {
        value: {
          handler(value) {
            this.editor.set(value);
          },
          deep: true,
        },
      },
      mounted() {
        const container = this.$refs.jsoneditor;
        const options = {
          mode: 'view'
        };

        this.editor = new JSONEditor(container, options);
        this.editor.set(this.value);
      }
    });

    Vue.component('debug-panel', {
      props: ['value'],
      template: `
    <div class="debug-panel" style="position: fixed; top: 0; right: 0;">
      <div style="display: flex; justify-content: flex-end;">
        <el-button type="primary" size="small" @click="toggleDebugMode"><i class="el-icon-more"></i></el-button>
      </div>

      <div v-show="showPanel">
        <json-viewer :value="value"></json-viewer>
      </div>
    </div>
      `,
      data: function () {
        return {
          showPanel: false,
        };
      },
      methods: {
        toggleDebugMode() {
          this.showPanel = !this.showPanel;
          localStorage.setItem('showDebugPanel', this.showPanel);
        },
      },
      mounted() {
        const showDebugPanel = localStorage.getItem('showDebugPanel');
        if (showDebugPanel) {
          this.showPanel = true;
        }
      }
    });
  },
};
