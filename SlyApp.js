document.head.innerHTML += `<link type="text/css" rel="stylesheet" href="https://supervise.ly/apps-designer.bundle.css">`;

import * as jsonpatch from 'https://cdn.jsdelivr.net/npm/fast-json-patch@3.1.0/index.mjs';
import throttle from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/throttle.js';
import cloneDeep from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/cloneDeep.js';
import jwtDecode from 'https://cdn.jsdelivr.net/npm/jwt-decode@3.1.2/build/jwt-decode.esm.js';

const completedAppStatusSet = new Set(['error', 'finished', 'terminating', 'stopped']);

function connectToSocket(url, ...namespaces) {
  const socket = io(`${url}/${namespaces.join('-')}`, {
    path: '/api/ws',
  });

  socket.on('connect', () => {
    socket.emit('authenticate', { token: localStorage.token });
  }).on('unauthorized', () => {
    socket.close();
    setTimeout(() => { socket.open(); }, 5000);
  });

  return socket;
}

function formatError(res, data = {}) {
  const err = new Error();

  err.status = res.status;
  err.title = res.statusText;
  err.details = data.details || data.detail;

  if (!err.details) {
    err.details = {
      message: 'Something went wrong',
    };
  } else if (typeof err.details !== 'object') {
    const errMsg = err.details;
    err.details = {
      message: errMsg,
    };
  }

  return err;
}

async function requestErrorHandler(res) {
  if (!res.ok) {
    let data;
    try {
      data = await res.json();
    } catch (err) {}

    throw formatError(res, data);
  }

  return res;
}

function applyPatch(document, patch) {
  return cloneDeep(jsonpatch.applyPatch(document, patch).newDocument);
}

Vue.component('sly-html-compiler', {
  props: ['template', 'state', 'data', 'context', 'params'],
  data() {
    return {
      templateRenderer: null,
    };
  },
  computed: {
    isHtml() {
      return this.template && typeof this.template === 'string' && this.template.trim().startsWith('<');
    },
  },
  render(createElement) {
    if (!this.templateRenderer) return '';

    if(this.isHtml) {
      return this.templateRenderer.call(this, createElement);
    } else {
      return this._v(this.template);
    }
  },

  watch: {
    template: {
      handler() {
        if (!this.template) return;

        const compiled = Vue.compile(this.template);
        this.$options.staticRenderFns = compiled.staticRenderFns;

        this.templateRenderer = compiled.render;
      },
      immediate: true,
    },
  }
});

Vue.component('sly-app-error', {
  template: `
<div>
  <el-dialog v-if="elementAvailable" v-model="visible" @close="onClose" :title="errorTitle" size="tiny">
    <div class="fflex" style="margin: -20px 0 -20px 0;">
      <i class="notification-box-icon el-icon-information information mr15" style="font-size: 35px; color: #50bfff;"></i>

      <span style="min-height: 35px; display: flex; align-items: center; word-break: break-word;">
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
      if (!err?.details?.message) return;
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
  <div ref="app-content">
    <slot v-if="!loading" :state="state" :data="data" :command="command" :post="post" />
  </div>
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
      publicApiInstance: null,
      appUrl: '',
      stateObserver: '',
    };
  },

  computed: {
    formattedUrl () {
      if (!this.appUrl) return '';
      return this.appUrl.replace(/\/$/, '');
    },
  },

  watch: {
    'task.status': {
      handler(newStatus) {
        const isCompleted = completedAppStatusSet.has(newStatus);

        if (!isCompleted) return;

        this.$nextTick(() => {
          this.$nextTick(() => {
            const appEl = this.$refs['app-content'];
            if (!appEl) return;

            const elements = appEl.querySelectorAll('.el-button,.el-input,.el-input__inner,.el-textarea,.el-textarea__inner,.el-input-number,.el-radio__input,.el-radio__original,.el-switch,.el-switch__input,.el-slider__runway,.el-checkbox__input,.el-checkbox__original');

            Array.prototype.slice.call(elements).forEach((el) => {
              el.setAttribute('disabled', true);
              el.classList.add('is-disabled');
              el.classList.add('disabled');
            });
          });
        });
      },
    },
  },

  methods: {
    async command(command, payload = {}) {
      console.log('Command!', command);

      await this.sendStatePatchToApi();

      this.ws.send(JSON.stringify({
        command: command,
        state: this.state,
        context: this.context,
        payload,
      }));
    },

    async sendStatePatchToApi() {
      const payload = {
        state: this.state,
      };

      await this.saveTaskDataToDB(payload);
    },

    async post(command, payload = {}) {
      console.log('Http!', command);

      await this.sendStatePatchToApi();

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
      return fetch(`${this.formattedUrl}${path}`, {
        method: 'POST',
      })
        .then(requestErrorHandler)
        .then(res => {
          if (contentOnly) {
            return res.json();
          }

          return res;
        })
        .then(res => res)
        .catch((err) => {
          this.$refs['err-dialog'].open(err);
        });
    },

    async merge(payload) {
      if (payload.state) {
        this.state = applyPatch(this.state, payload.state);
      }

      if (payload.data) {
        this.data = applyPatch(this.data, payload.data);
      }

      await this.saveTaskDataToDB(payload);
    },

    async saveTaskDataToDB(payload) {
      if (!this.publicApiInstance || !this.task?.id || (!payload.state && !payload.data)) return;

      try {
        await this.publicApiInstance.post('tasks.app-v2.data.set', {
          taskId: this.task.id,
          payload: {
            ...payload,
            state: this.state,
          },
        });
      } catch (err) {
        if (!this.$refs['err-dialog']) return;

        const formattedErr = formatError(err.response, err.response?.data);
        this.$refs['err-dialog'].open(formattedErr);
      }
    },

    updateTaskData(payload) {
      if (!this.task?.id || !payload[0].status) return;

      this.task.status = payload[0].status;
    },

    connectToWs() {
      this.ws = new WebSocket(`ws${document.location.protocol === "https:" ? "s" : ""}://${this.appUrl.replace("http://", "").replace("https://", "").replace(/\/$/, '')}/sly/ws`);

      this.ws.onmessage = (event) => {
        console.log('Message received from Python', event);
        this.merge(JSON.parse(event.data));
      };

      this.ws.onopen = () => {
        clearInterval(this.wsTimerId);

        if (!this.isDebugMode) {
          this.ws.onclose = () => {
            console.log('WS connection closed');

            this.wsTimerId = setInterval(() => {
              this.connectToWs();
            }, 8000);
          };
        }
      };
    }, 
  },

  async created() {
    this.post.throttled = throttle(this.post, 1200);

    try {
      const rawUrl = new URL(this.url);
      let rawIntegrationData = rawUrl.searchParams.get('slyContext');

      this.appUrl = `${rawUrl.origin}${rawUrl.pathname}`;

      let integrationData = {};

      if (rawIntegrationData) {
        try {
          integrationData = JSON.parse(rawIntegrationData);
        } catch (err) {
          console.error(err);
        }
      }

      this.sessionInfo = await this.getJson('/sly/session-info') || {};

      let taskId;
      let apiToken;
      let serverAddress;

      if (localStorage.token) {
        const tokenData = jwtDecode(localStorage.token);
        
        integrationData.apiToken = tokenData.apiToken;
        integrationData.token = localStorage.token;
      }

      if (this.sessionInfo?.SERVER_ADDRESS || integrationData?.serverAddress) {
        serverAddress = this.sessionInfo?.SERVER_ADDRESS || integrationData.serverAddress;
      }

      if (sly.publicApiInstance && serverAddress) {
        apiToken = integrationData?.apiToken || this.sessionInfo?.API_TOKEN;
        serverAddress = `${serverAddress.endsWith('/') ? serverAddress.slice(0, -1) : serverAddress}`;

        if (apiToken) {
          this.context.apiToken = apiToken;
          sly.publicApiInstance.defaults.headers.common['x-api-key'] = apiToken;
        }

        sly.publicApiInstance.defaults.baseURL = serverAddress + '/public/api/v3';
        this.publicApiInstance = sly.publicApiInstance;

        taskId = this.sessionInfo?.TASK_ID || integrationData.taskId;

        if (taskId) {
          this.task = await sly.publicApiInstance.post('/tasks.info', { id: taskId }).then(r => r.data);

          const taskData = this.task?.settings?.customData;

          if (taskData) {
            const { state = {}, data = {} } = taskData;
            this.state = state;
            this.data = data;
          }

          if (window.io) {
            if (integrationData.token) {
              connectToSocket(serverAddress);
              this.taskSocket = connectToSocket(serverAddress, 'tasks');

              this.taskSocket.on('changed:progress', this.updateTaskData);
            }
          } else {
            console.warn('socket.io-client isn\'t available');
          }
        }
      }

      this.integrationData = integrationData;

      const stateRes = await this.getJson('/sly/state', false);
      let state;

      if (stateRes) {
        this.isDebugMode = !!stateRes.headers.get('x-debug-mode');
        state = await stateRes.json();
      }

      const data = await this.getJson('/sly/data');

      if (state) {
        this.state = state;
      }

      if (data) {
        this.data = data;
      }

      if (this.publicApiInstance && taskId && serverAddress) {
        const initialState = {};

        const stateKeys = Object.keys(this.state);

        if (stateKeys?.length) {
          initialState.state = stateKeys.map(key => ({ op: 'add', path: `/${key}`, value: this.state[key] }));
        }

        const dataKeys = Object.keys(this.data);

        if (dataKeys?.length) {
          initialState.data = dataKeys.map(key => ({ op: 'add', path: `/${key}`, value: this.data[key] }));
        }

        await this.saveTaskDataToDB(initialState);
      }

      this.stateObserver = jsonpatch.observe(this.state);
    } catch(err) {
      throw err;
    } finally {
      this.loading = false;
    }

    console.log('First Init WS');
    this.connectToWs();
  },

  beforeDestroy() {
    if (this.taskSocket) {
      this.taskSocket.off('changed:progress', this.updateTaskData);
    }

    if (this.wsTimerId) {
      clearInterval(this.wsTimerId);
    }
  }
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
