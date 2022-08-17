import * as jsonpatch from 'https://cdn.jsdelivr.net/npm/fast-json-patch@3.1.1/index.mjs';
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

async function requestErrorHandler(res, task) {
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
  return jsonpatch.applyPatch(document, patch, false, false).newDocument;
}

Vue.component('sly-debug-panel', {
  props: ['value'],
  template: `
    <div style="z-index: 9999999; position: fixed; top: 0; right: 0; background: rgba(255,255,255,0.5); padding: 5px; border-radius: 4px;">
      <div style="display: flex; justify-content: flex-end;">
        <el-button type="text" @click="isOpen = !isOpen" style="padding: 0;">
          <i :class="[isOpen ? 'el-icon-caret-top' : 'el-icon-caret-bottom']"></i>
        </el-button>
      </div>

      <div v-show="isOpen">
        <div ref="jsoneditor" style="width: 340px; height: calc(100vh - 40px)"></div>
      </div>
    </div>
  `,
  data: function () {
    return {
      isOpen: false,
    };
  },

  watch: {
    value(value) {
      this.editor.set(value);
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

      this.$nextTick(() => {
        this.visible = true;
      });
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
    },
    hotkeys: {
      type: Array,
      default: () => [],
    },
  },

  template: `
<div>
  <sly-app-error ref="err-dialog"></sly-app-error>
  <div ref="app-content">
    <slot v-if="!loading" :state="state" :data="data" :command="command" :post="post" :session="task" />
  </div>

  <sly-debug-panel v-if="isDebugMode" :value="{ state: state, data: data }" />
</div>
  `,

  data: function () {
    return {
      loading: true,
      task: {},
      state: {
        scrollIntoView: null,
        slyNotification: null,
      },
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
          setTimeout(() => {
            const appEl = this.$refs['app-content'];
            if (!appEl) return;

            const elements = appEl.querySelectorAll('.el-button,.el-input,.el-input__inner,.el-textarea,.el-textarea__inner,.el-input-number,.el-radio__input,.el-radio__original,.el-switch,.el-switch__input,.el-slider__runway,.el-checkbox__input,.el-checkbox__original');

            Array.prototype.slice.call(elements).forEach((el) => {
              el.setAttribute('disabled', true);
              el.classList.add('is-disabled');
              el.classList.add('disabled');
            });
          }, 1000);
        });
      },
      immediate: true,
    },
    'state.scrollIntoView': {
      handler() {
        this.$nextTick(() => {
          const ref = this.state?.scrollIntoView;
    
          if (!ref) return;
      
          const component = this.$refs['app-content'].querySelector(`#${ref}`);
      
          if (!component) return;
      
          component.scrollIntoView({ behavior: 'smooth', block: 'start' });

          this.state.scrollIntoView = null;
        });
      },
      immediate: true,
    },
    'state.slyNotification': {
      handler() {
        this.$nextTick(() => {
          if (!this.state.slyNotification) return;

          this.$message(this.state.slyNotification);

          this.state.slyNotification = null;
        });
      },
      immediate: true,
      deep: true,
    },
  },

  methods: {
    checkPreviewMode() {
      if (!this.task || !completedAppStatusSet.has(this.task.status)) return false;

      this.$refs['err-dialog'].open({
        details: {
          message: 'Current application session is finished and available only in preview mode. You need to run this app again',
        },
      });

      return true;
    },

    async command(command, payload = {}) {
      console.log('Command!', command);

      if (this.checkPreviewMode()) return;

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

      if (this.checkPreviewMode()) return;

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
      if (this.checkPreviewMode()) return;

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
      if (!this.task?.id || !payload?.[0]?.status) return;

      this.task.status = payload[0].status;
    },

    connectToWs() {
      this.ws = new WebSocket(`ws${document.location.protocol === "https:" ? "s" : ""}://${this.appUrl.replace("http://", "").replace("https://", "").replace(/\/$/, '')}/sly/ws`);

      this.ws.onmessage = (event) => {
        console.log('Message received from Python', event);

        if (!event.data || typeof event.data !== 'string') return;

        let parsedData;
        try {
          parsedData = JSON.parse(event.data);
        } catch (err) {
          console.error(err);
          return;
        }

        this.merge(parsedData);
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

    hotkeysHandler(e) {
      const k = this.hotkeys.filter(h => h.keyCode === e.keyCode);
      let hotkey;
      
      for(let i = 0; i < k.length; i++) {
        const curK = k[i];

        curK.modifiers.forEach((mod) => {
          if (!e[`${mod}Key`]) return;
        });

        hotkey = curK;
        break;
      }

      if (hotkey) {
        hotkey.handler({ state: this.state, data: this.data, command: this.command, post: this.post });
      }
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

      if (!integrationData.isStaticVersion) {
        this.sessionInfo = await this.getJson('/sly/session-info') || {};
      }

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

      if (serverAddress) {
        apiToken = integrationData?.apiToken || this.sessionInfo?.API_TOKEN;
        serverAddress = `${serverAddress.endsWith('/') ? serverAddress.slice(0, -1) : serverAddress}`;

        if (sly.publicApiInstance) {
          sly.publicApiInstance.defaults.baseURL = serverAddress + '/public/api/v3';
          this.publicApiInstance = sly.publicApiInstance;
        } else {
          this.publicApiInstance = axios.create({
            baseURL: `${serverAddress}/public/api/v3`,
          });

        }

        if (apiToken) {
          this.context.apiToken = apiToken;
          this.publicApiInstance.defaults.headers.common['x-api-key'] = apiToken;
        }

        taskId = this.sessionInfo?.TASK_ID || integrationData.taskId;

        if (taskId) {
          try {
            this.task = await this.publicApiInstance.post('/tasks.info', { id: taskId }).then(r => r.data);

            const taskData = this.task?.settings?.customData;

            if (taskData) {
              const { state = {}, data = {} } = taskData;
              this.state = state;
              this.data = data;
            }
          } catch (err) {
            console.error(err);
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

      if (!integrationData.isStaticVersion) {
        const stateRes = await this.getJson('/sly/state', false);
        let state;

        if (stateRes) {
          this.isDebugMode = !!stateRes.headers.get('x-debug-mode');
          console.log('State headers:', stateRes.headers);
          state = await stateRes.json();
        }

        const data = await this.getJson('/sly/data');

        if (state) {
          this.state = state;
        }

        if (data) {
          this.data = data;
        }
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

        if (!integrationData.isStaticVersion && this.task.status !== 'finished' && this.task.status !== 'stopped') {
          await this.saveTaskDataToDB(initialState);
        }
      }

      document.addEventListener('keypress', this.hotkeysHandler);

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

    document.removeEventListener('keypress', this.hotkeysHandler);
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

let scriptsLoadedCount = 0;
let domLoaded = false;

function initApp() {
  if (!domLoaded || scriptsLoadedCount !== scripts.length) return;
  slyApp.init();
}

document.addEventListener('DOMContentLoaded', function() {
  domLoaded = true;
  initApp();
});

const scripts = [
  'https://cdn.jsdelivr.net/npm/jsoneditor@9.7.0/dist/jsoneditor.min.js',
  'https://cdn.jsdelivr.net/npm/jsoneditor@9.7.0/dist/jsoneditor.min.css',
  'https://cdn.jsdelivr.net/npm/socket.io-client@2.0.4/dist/socket.io.js',
  'https://cdn.jsdelivr.net/npm/axios@0.17.1/dist/axios.min.js',
];

scripts.forEach((f) => {
  let el;
  let srcField = 'src';

  if (f.endsWith('.js')) {
    el = document.createElement('script');

  } else {
    srcField = 'href';
    el = document.createElement('link');
    el.type = 'text/css';
    el.rel = 'stylesheet';
  }

  el.onload = function () {
    scriptsLoadedCount += 1;

    initApp();
  };

  el[srcField] = f;

  document.head.appendChild(el);
});
