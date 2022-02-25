document.head.innerHTML += `<link type="text/css" rel="stylesheet" href="https://supervise.ly/apps-designer.bundle.css">`;

import * as jsonpatch from 'https://cdn.jsdelivr.net/npm/fast-json-patch@3.1.0/index.mjs';
import throttle from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/throttle.js';

const vuePatchOptsSet = new Set(['add', 'remove', 'replace']);

function requestErrorHandler(res) {
  console.dir(res);
  if (!res.ok) {
    console.dir()
    const err = new Error();

    err.status = res.status;
    err.title = res.statusText;
    err.details = res.details || { message: 'Something went wrong' };

    console.dir(err);

    throw err;
  }

  return res;
}

function applyPatch(document, patch) {
  let curDocument = document;

  patch.forEach((operation) => {
    if (vuePatchOptsSet.has(operation.op)) {
      const pathParts = operation.path.split('/');
      const propName = pathParts.splice(-1)[0];

      let parentObject;

      if (pathParts.length > 1) {
        parentObject = jsonpatch.getValueByPointer(curDocument, pathParts.join('/'));
      } else {
        parentObject = curDocument;
      }

      if (typeof parentObject !== 'object') {
        curDocument = jsonpatch.applyOperation(document, operation).newDocument;
        return;
      };

      if (operation.op === 'add' || operation.op === 'replace') {
        Vue.set(parentObject, propName, operation.value);
      } else {
        Vue.delete(parentObject, propName);
      }
    } else {
      curDocument = jsonpatch.applyOperation(document, operation).newDocument;
    }
  });

  return curDocument;
}

Vue.component('sly-app-error', {
  components: {
    'el-dialog': Vue.options.components.ElDialog,
  },

  template: `
<div>
  <el-dialog v-if="elementAvailable" v-model="visible" @close="onClose" :title="errorTitle">
    <div class="fflex">
      <i class="notification-box-icon zmdi zmdi-alert-triangle mr5" style="font-size: 25px; color: rgb(238, 131, 131);"></i>

      <span>
        {{ errorMessage }}
      </span>
    </div>

    <div slot="footer">
      <el-button type="primary" @click="close">Ok</el-button>
    </div>
  </el-dialog>

  <div v-else-if="visible" class="notification-box notification-box-warning" style="background-color:lightgray;padding:10px;border-radius:6px;display:flex;align-items:center;background-color:rgb(255 236 236);border:1px solid rgb(255 214 214);border-left:4px solid rgb(238, 131, 131);">
    <i class="notification-box-icon zmdi zmdi-alert-triangle" style="font-size: 25px;margin-right: 10px;color: rgb(238, 131, 131);"></i>

    <div>
      <div class="notification-box-title" style="font-size: 16px; font-weight: bold;">{{errorTitle}}</div>
      {{ errorMessage }}
    </div>
  </div>
</div>
  `,

  data() {
    return {
      visible: false,
      err: null,
    };
  },

  computed: {
    elementAvailable () {
      return !!window.sly;
    },

    errorTitle() {
      if (!this.err) return '';

      return this.err.details.title || this.err.title || '';
    },

    errorMessage() {
      if (!this.err) return '';

      return this.err.details.message;
    },
  },

  methods: {
    open(err) {
      console.dir(err);
      if (!err.details.message) return;
      this.err = err;
      this.visible = true;
    },

    onClose() {
      this.err = null;
    },

    close() {
      this.visible = false;
      this.onClose();
    },
  },
});

Vue.component('sly-app', {
  props: {
    url: {
      type: String,
      default: document.location.href,
    }
  },

  template: `
<div>
  <sly-app-error ref="err-dialog"></sly-app-error>
  <slot v-if="!loading" :state="state" :data="data" :command="command" :post="post" />
</div>
  `,

  data: function () {
    return {
      loading: true,
      task: {},
      state: {},
      data: {},
      sessionInfo: {},
      context: {},
      ws: null,
      isDebugMode: false,
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
      })
      .then(requestErrorHandler)
      .then(res => res.json())
      .then((json) => {
        if (!json) return;

        this.merge(json);
      })
      .catch((err) => {
        this.$refs['err-dialog'].open(err);
        throw err;
      });
    },

    async getJson(path, contentOnly = true) {
      fetch(`${this.formattedUrl}${path}`, {
        method: 'POST',
      })
        .then(requestErrorHandler)
        .then(res => {
          if (contentOnly) {
            return res.json().then(json => json);
          }

          return res;
        })
        .catch((err) => {
          this.$refs['err-dialog'].open(err);
          throw err;
        });
    },

    merge(payload) {
      if (payload.state) {
        this.state = applyPatch(this.state, payload.state);
      }

      if (payload.data) {
        this.data = applyPatch(this.data, payload.data);
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
          console.log('WS connection closed');
          // this.wsTimerId = setInterval(() => {
          //   this.connectToWs();
          // }, 6000);
        };
      };
    }
  },

  async created() {
    this.post.throttled = throttle(this.post, 1200);

    try {
      const stateRes = await this.getJson('/sly/state', false);
      this.isDebugMode = !!stateRes.headers['x-debug-mode'];
      this.state = await stateRes.json().then(json => json);
      this.data = await this.getJson('/sly/data');
      this.sessionInfo = await this.getJson('/sly/session-info');

      if (sly.publicApiInstance) {
        if (this.sessionInfo?.API_TOKEN) {
          sly.publicApiInstance.defaults.headers.common['x-api-key'] = this.sessionInfo.API_TOKEN;
        }

        if (sly.publicApiInstance && this.sessionInfo?.SERVER_ADDRESS) {
          const { SERVER_ADDRESS } = this.sessionInfo;
          sly.publicApiInstance.defaults.baseURL = `${SERVER_ADDRESS.endsWith('/') ? SERVER_ADDRESS.slice(0, -1) : SERVER_ADDRESS}/public/api/v3`;
        }
      }
    } catch(err) {
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

document.addEventListener('DOMContentLoaded', function() {
  slyApp.init();
});
