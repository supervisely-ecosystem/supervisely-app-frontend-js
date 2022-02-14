document.head.innerHTML += `<link type="text/css" rel="stylesheet" href="https://supervise.ly/apps-designer.bundle.css">`;

import * as jsonpatch from 'https://cdn.jsdelivr.net/npm/fast-json-patch@3.1.0/index.mjs';
import throttle from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/throttle.js';

function initApp() {
  if (window.sly && window.sly.Vue) {
    window.Vue = sly.Vue;
  }

  Vue.component('sly-app', {
    props: {
      url: {
        type: String,
        default: document.location.href,
      }
    },
    template: `
<div>
  <slot v-if="!loading" :state="state" :data="data" :command="command" :post="post" />
</div>
    `,

    data: function () {
      return {
        loading: true,
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
      command(command, payload = {}) {
        console.log('Command!', command);
        this.ws.send(JSON.stringify({ command: command, state: this.state, payload }));
      },

      post(command, payload = {}) {
        console.log('Http!', command);

        fetch(`${this.formattedUrl}${command}`, {
            method: 'POST',
            body: JSON.stringify({
              state: this.state,
              context: this.context,
              payload,
            }),
            headers: {'Content-Type': 'application/json'}
        }).then(res => res.json()).then((json) => {
          if (!json) return;

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

      connectToWs() {
        this.ws = new WebSocket(`ws${document.location.protocol === "https:" ? "s" : ""}://${this.url.replace("http://", "").replace("https://", "").replace(/\/$/, '')}/sly/ws`);

        this.ws.onmessage = (event) => {
          console.log('Message received from Python', event);
          this.merge(JSON.parse(event.data));
        };

        this.ws.onopen = () => {
          clearInterval(this.wsTimerId);

          this.ws.onclose = () => {
            this.wsTimerId = setInterval(() => {
              this.connectToWs();
            }, 2000);
          };
        };
      }
    },

    async created() {
      this.post.throttled = throttle(this.post, 1200);

      try {
        this.state = await this.getJson('/sly/state');
        this.data = await this.getJson('/sly/data');
      } finally {
        this.loading = false;
      }

      console.log('First Init WS');
      this.connectToWs();
    },
  });

  window.slyApp = {
    app: null,
    init() {
      if (this.app) return;

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

  slyApp.init();
}

document.addEventListener('DOMContentLoaded', function() {
  const script = document.createElement('script');
  script.onload = function () {
    initApp();
  };

  script.src = 'https://supervise.ly/apps-designer.bundle.js';

  document.head.appendChild(script);
});
