Vue.component('sly-app', {
  props: ['url', 'initState'],
  template: `
<div>
  <slot :state="state" :data="data" :command="command" :http="http" />
</div>
  `,

  data: function () {
    return {
      task: {},
      state: {},
      data: {},
      context: {},
      ws: null,
    };
  },

  computed: {
    formattedUrl () {
      return this.url.replace(/\/$/, '');
    },
  },

  methods: {
    command(command) {
      console.log('Command!', command);
      this.ws.send(JSON.stringify({ command: command, state: this.state }));
    },

    http(command) {
      console.log('Http!', command);

      fetch(`${this.formattedUrl}${command}`, {
          method: 'POST',
          body: JSON.stringify({
            state: this.state,
            context: this.context,
          }),
          headers: {'Content-Type': 'application/json'}
      }).then(res => res.json()).then((json) => {
          this.merge(json);
      });
    },

    async getJson(path) {
      return fetch(`${this.formattedUrl}${path}`, {
        method: 'POST',
      })
      .then(res => res.json()).then((json) => {
        return json;
      });
    },

    merge(payload) {
      if (payload.state) {
        this.state = jsonpatch.applyPatch(this.state, payload.state).newDocument;
      }

      if (payload.data) {
        this.data = jsonpatch.applyPatch(this.data, payload.data).newDocument;
      }
    },
  },

  async created() {
    console.log('First Init WS');
    this.state = await this.getJson('/sly-app-state');
    this.data = await this.getJson('/sly-app-data');

    this.ws = new WebSocket(`ws${document.location.protocol === "https:" ? "s" : ""}://${this.url.replace("http://", "").replace("https://", "").replace(/\/$/, '')}/sly-app-ws`);
    this.ws.onmessage = (event) => {
      console.log('Message received from Python', event.data);
      this.merge(event.data);
    };
  },
});

window.slyApp = {
  app: null,
  init() {
    this.app = new Vue({
      el: '#sly-app',
      computed: {
          document() {
              return document;
          }
      },
    });
  },
};
