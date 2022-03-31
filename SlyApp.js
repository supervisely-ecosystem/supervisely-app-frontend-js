document.head.innerHTML += `<link type="text/css" rel="stylesheet" href="https://supervise.ly/apps-designer.bundle.css">`;

import * as jsonpatch from 'https://cdn.jsdelivr.net/npm/fast-json-patch@3.1.0/index.mjs';
import throttle from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/throttle.js';
import cloneDeep from 'https://cdn.jsdelivr.net/npm/lodash-es@4.17.21/cloneDeep.js';
import jwtDecode from 'https://cdn.jsdelivr.net/npm/jwt-decode@3.1.2/build/jwt-decode.esm.js';

const vuePatchOptsSet = new Set(['add', 'remove', 'replace', 'move']);
// const vuePatchOptsSet = new Set(['add', 'remove', 'replace']);
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
  let curDocument = document;

  // patch.forEach((operation) => {
  //   console.log('> operation:', operation.op, operation);
  //   if (vuePatchOptsSet.has(operation.op)) {
  //     const pathParts = operation.path.split('/');
  //     const propName = pathParts.splice(-1)[0];

  //     let parentObject;

  //     if (pathParts.length > 1) {
  //       parentObject = jsonpatch.getValueByPointer(curDocument, pathParts.join('/'));
  //     } else {
  //       parentObject = curDocument;
  //     }

  //     console.log('> parentObject:', cloneDeep(parentObject));

  //     // if (typeof parentObject !== 'object' || (Array.isArray(parentObject) && typeof operation.value !== 'object')) {
  //     if (typeof parentObject !== 'object') {
  //       curDocument = jsonpatch.applyOperation(document, operation).newDocument;
  //       console.log('> 1:', cloneDeep(curDocument));
  //       return;
  //     };

  //     if (operation.op === 'add' || operation.op === 'replace') {
  //       if (operation.op === 'add' && Array.isArray(parentObject)) {
  //         parentObject.splice(propName, 0, operation.value);
  //       } else {
  //         Vue.set(parentObject, propName, operation.value);
  //       }
  //       console.log('> 2:', cloneDeep(curDocument));
  //     } else if (operation.op === 'move') {

  //       console.log('==============================1');
  //         const pathPartsFrom = operation.from.split('/');
  //         const propNameFrom = pathPartsFrom.splice(-1)[0];

  //         let parentObjectFrom;

  //         if (pathParts.length > 1) {
  //           parentObjectFrom = jsonpatch.getValueByPointer(curDocument, pathPartsFrom.join('/'));
  //         } else {
  //           parentObjectFrom = curDocument;
  //         }

  //         const moveValue = jsonpatch.getValueByPointer(curDocument, operation.from);
  //         console.log('==============================1.1', operation.from, cloneDeep(parentObjectFrom), moveValue);
  //         console.log('==============================1.2', operation.path, cloneDeep(parentObject), moveValue);

  //         Vue.set(parentObject, propName, moveValue);
  //         console.log('==============================2', operation.from, operation.path, moveValue);

  //         console.log('> 2.1:', pathPartsFrom, cloneDeep(parentObjectFrom), propNameFrom);
  //         Vue.delete(parentObjectFrom, propNameFrom);
  //         console.log('> 2.2:', pathPartsFrom, cloneDeep(parentObjectFrom), propNameFrom);
  //         console.log('> 2.3:', cloneDeep(curDocument));
  //     } else {
  //       Vue.delete(parentObject, propName);
  //       console.log('> 3:', cloneDeep(curDocument));
  //     }
  //   } else {
  //     curDocument = jsonpatch.applyOperation(document, operation).newDocument;
  //     console.log('> 4:', cloneDeep(curDocument));
  //   }
  // });

  // return curDocument;
  return jsonpatch.applyPatch(document, patch).newDocument;
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
    <!--<el-button @click="test">Apply</el-button>-->
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
    test() {
      this.merge({
        state:[{'op': 'add', 'path': '/widgets/SmartTool/0008/scaledBbox/0/0', 'value': 301}, {'op': 'add', 'path': '/widgets/SmartTool/0008/scaledBbox/0/1', 'value': 288}, {'op': 'replace', 'path': '/widgets/SmartTool/0008/scaledBbox/1/0', 'value': 531}, {'op': 'replace', 'path': '/widgets/SmartTool/0008/scaledBbox/1/1', 'value': 617}, {'op': 'replace', 'path': '/widgets/SmartTool/0001/scaledBbox/0/0', 'value': 434}, {'op': 'replace', 'path': '/widgets/SmartTool/0001/scaledBbox/0/1', 'value': 305}, {'op': 'add', 'path': '/widgets/SmartTool/0001/scaledBbox/1/0', 'value': 689}, {'op': 'remove', 'path': '/widgets/SmartTool/0001/scaledBbox/1/2'}, {'op': 'add', 'path': '/widgets/SmartTool/0001/scaledBbox/1/1', 'value': 652}, {'op': 'replace', 'path': '/widgets/SmartTool/0007/scaledBbox/0/0', 'value': 274}, {'op': 'replace', 'path': '/widgets/SmartTool/0007/scaledBbox/0/1', 'value': 218}, {'op': 'replace', 'path': '/widgets/SmartTool/0007/scaledBbox/1/0', 'value': 501}, {'op': 'replace', 'path': '/widgets/SmartTool/0007/scaledBbox/1/1', 'value': 556}, {'op': 'replace', 'path': '/widgets/SmartTool/0002/scaledBbox/0/0', 'value': 184}, {'op': 'replace', 'path': '/widgets/SmartTool/0002/scaledBbox/0/1', 'value': 148}, {'op': 'replace', 'path': '/widgets/SmartTool/0002/scaledBbox/1/0', 'value': 403}, {'op': 'replace', 'path': '/widgets/SmartTool/0002/scaledBbox/1/1', 'value': 547}, {'op': 'replace', 'path': '/widgets/SmartTool/0006/scaledBbox/0/0', 'value': 234}, {'op': 'remove', 'path': '/widgets/SmartTool/0006/scaledBbox/0/1'}, {'op': 'move', 'from': '/widgets/SmartTool/0008/scaledBbox/0/3', 'path': '/widgets/SmartTool/0006/scaledBbox/0/1'}, {'op': 'replace', 'path': '/widgets/SmartTool/0006/scaledBbox/1/0', 'value': 489}, {'op': 'replace', 'path': '/widgets/SmartTool/0006/scaledBbox/1/1', 'value': 591}, {'op': 'replace', 'path': '/widgets/SmartTool/0000/scaledBbox/0/0', 'value': 443}, {'op': 'replace', 'path': '/widgets/SmartTool/0000/scaledBbox/0/1', 'value': 109}, {'op': 'replace', 'path': '/widgets/SmartTool/0000/scaledBbox/1/0', 'value': 692}, {'op': 'replace', 'path': '/widgets/SmartTool/0000/scaledBbox/1/1', 'value': 489}, {'op': 'replace', 'path': '/widgets/SmartTool/0005/scaledBbox/0/0', 'value': 260}, {'op': 'remove', 'path': '/widgets/SmartTool/0005/scaledBbox/0/1'}, {'op': 'move', 'from': '/widgets/SmartTool/0008/scaledBbox/0/2', 'path': '/widgets/SmartTool/0005/scaledBbox/0/1'}, {'op': 'replace', 'path': '/widgets/SmartTool/0005/scaledBbox/1/0', 'value': 483}, {'op': 'replace', 'path': '/widgets/SmartTool/0005/scaledBbox/1/1', 'value': 659}, {'op': 'replace', 'path': '/widgets/SmartTool/0009/scaledBbox/0/0', 'value': 169}, {'op': 'replace', 'path': '/widgets/SmartTool/0009/scaledBbox/0/1', 'value': 168}, {'op': 'replace', 'path': '/widgets/SmartTool/0009/scaledBbox/1/0', 'value': 415}, {'op': 'replace', 'path': '/widgets/SmartTool/0009/scaledBbox/1/1', 'value': 477}, {'op': 'replace', 'path': '/widgets/SmartTool/0004/scaledBbox/0/0', 'value': 201}, {'op': 'replace', 'path': '/widgets/SmartTool/0004/scaledBbox/0/1', 'value': 93}, {'op': 'replace', 'path': '/widgets/SmartTool/0004/scaledBbox/1/0', 'value': 432}, {'op': 'replace', 'path': '/widgets/SmartTool/0004/scaledBbox/1/1', 'value': 443}, {'op': 'replace', 'path': '/widgets/SmartTool/0003/scaledBbox/0/0', 'value': 455}, {'op': 'replace', 'path': '/widgets/SmartTool/0003/scaledBbox/0/1', 'value': 255}, {'op': 'remove', 'path': '/widgets/SmartTool/0003/scaledBbox/1/0'}, {'op': 'move', 'from': '/widgets/SmartTool/0001/scaledBbox/1/2', 'path': '/widgets/SmartTool/0003/scaledBbox/1/0'}, {'op': 'replace', 'path': '/widgets/SmartTool/0003/scaledBbox/1/1', 'value': 628}],
      });
    },

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
        this.state = cloneDeep(applyPatch(this.state, payload.state));
      }

      if (payload.data) {
        this.data = cloneDeep(applyPatch(this.data, payload.data));
      }

      console.log('==========', JSON.stringify(this.state));

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

      // this.state = {'widgets': {'SmartTool': {'0000': {'identifier': '0000', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/k/6/3r/M7uD41QMNo4vdBn0ghawUhBnuS7kVrTDBTZsUtqSNVTBXNYVbkcmYbxOim78mDJuJq7AmtBNl42IUQmcSCWYrKn4sGuSF5aGqP5o8likSyiQSjE8akrHObKqzxax.png', 'imageHash': 'Krji9khnu2H/+wSXit6F1ybt96Zfu7bU1dhelIosgFs=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[451, 121], [684, 477]], 'scaledBbox': [[445, 111], [690, 487]], 'mask': null, 'isActive': true, 'slyId': 58030161, 'needsAnUpdate': false}, '0001': {'identifier': '0001', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/w/t/XO/IL94JuOz0S60JGInPpXYHDaYsC4nIZ9eKJ6kWNlzl8VA2Mh2poUaAtjcdCcKZ8e1ZVBtFfNCNYJ1z1U5MjeyAlOx9slU87J90N9zcsuBuXrwoi98dv2c3QSZBOro.png', 'imageHash': 'FzgKpcuPo7EjxHFCfZvhOlS1OaGydcYG2K4l9UqBbBU=', 'imageSize': [1008, 756], 'datasetName': 'Test', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[442, 316], [681, 641]], 'scaledBbox': [[435, 307], [688, 650]], 'mask': null, 'isActive': true, 'slyId': 58032974, 'needsAnUpdate': false}, '0002': {'identifier': '0002', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/v/n/3o/vRW6Wa3So7BEx7hF2xFdUOisY3o4t9HVL8ygqp2MkeMQScqlf9AMcIkDMd8hkb0pj1q7NTwELPhVeDMZv9T3eJX24Y1WVw3fmXtkLJlndPsvGB5NRFFmWI16Im0H.png', 'imageHash': '2aDlJO2OLzV5hW5HMx80NEh5DIHvvWsCTcZ9DaXtcjc=', 'imageSize': [1008, 756], 'datasetName': 'Test', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[191, 161], [396, 534]], 'scaledBbox': [[185, 150], [402, 545]], 'mask': null, 'isActive': true, 'slyId': 58032947, 'needsAnUpdate': false}, '0003': {'identifier': '0003', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/z/Z/kw/Yr4LANPj1ZwSMhc2ndG32KVhzegiepXSmGxjsfAmHkAEgxd8xji2sr7O1LbyF71qoUgCH5gIiIAuPX5lch2waGSQfKj4hSMYWPcGll0aExwFJmdviIvcYdFwIZsz.png', 'imageHash': 'prHb83oobtg/gZXYmGUlE7TdllhD0RbtAdrLugnPebM=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[462, 267], [681, 616]], 'scaledBbox': [[456, 257], [687, 626]], 'mask': null, 'isActive': true, 'slyId': 58029883, 'needsAnUpdate': false}, '0004': {'identifier': '0004', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/0/o/Wn/PsRQAeOKW5HejOsktnMbRni3t5Y4338ZLHhIHEdNtVp0O0QNaBGpHo79d2qCXqkVVNGR3f7LAfZVzSFEVFU8K0GvCMwKONUNxovDuNxqkeo7SDckcq3wnNF3Qstd.png', 'imageHash': 'qmexHaqop5EwgBnom9VCU6KBPci2oB8/wn3bgraME10=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[208, 104], [425, 432]], 'scaledBbox': [[202, 95], [431, 441]], 'mask': null, 'isActive': true, 'slyId': 58031645, 'needsAnUpdate': false}, '0005': {'identifier': '0005', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/Q/N/OG/ZwcXbT4SsHaTbiUxKCpZdjldutIgoSPBIBAWEcizAnXxlYimsL7jxlE8qRVTbj72ryxLTCdazhIOsPjgItUxNl5RP3hNjCrNEnM9cGqA2RwSF64kGtBSdkIhNG0O.png', 'imageHash': 'sOvlmCbWsPVg6xLFjBaAnBmqklC+EViT7aQMc1VXujU=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[267, 313], [476, 648]], 'scaledBbox': [[261, 303], [482, 658]], 'mask': null, 'isActive': true, 'slyId': 58032297, 'needsAnUpdate': false}, '0006': {'identifier': '0006', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/a/R/9i/YHwK1ERp2oBczF0xgRBhudanatRInXbKM6oCle7Q7vEE8rvgskEFixo67L2zpSy3j0Za1c5V64TspNGSURcO4KVY8suNAbprUVDHC24DcC9JgdY7uP0dDbHQwUOE.png', 'imageHash': '2Uw3LenDRqWmelxWKhVJkbaN/YNYFTfMTSCFLVLT/xA=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[242, 298], [481, 582]], 'scaledBbox': [[235, 290], [488, 590]], 'mask': null, 'isActive': true, 'slyId': 58032001, 'needsAnUpdate': false}, '0007': {'identifier': '0007', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/l/d/qm/lt6wLBNuoimPgiNMguDpXUGwmoc8LhSRotgZwXyk8lpoZAVwMCc2u335WRib6FGCDP2wn9AjiAKHk77Sq7CCbJSPbqpy7946JbhazS8J6X2iXoSIXIqFh0YAtPv6.png', 'imageHash': 'x2KmMSPC8r2nnY+ZyZUhuuxSEyMc2L2I2wQfz/DBJ1k=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[281, 229], [494, 545]], 'scaledBbox': [[275, 220], [500, 554]], 'mask': null, 'isActive': true, 'slyId': 58030363, 'needsAnUpdate': false}, '0008': {'identifier': '0008', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/9/j/Zm/pR6It9cVo4CvLkxLiQL5NTVwrAzoe0x8EfbRwEsxdvq5sl25HpMeXY0IeC3yrWKIOgeyt3u291WT3wkVLom9391BfFfFsm7egYqYbv4ol8aTmPag7K5FLtmUM2HY.png', 'imageHash': 'bP0fO1v01z2+9jlsw7fD8yDYjw3a0ZAf1LBa2bh6VDw=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[308, 298], [524, 607]], 'scaledBbox': [[302, 289], [530, 616]], 'mask': null, 'isActive': true, 'slyId': 58029540, 'needsAnUpdate': false}, '0009': {'identifier': '0009', 'imageUrl': 'https://supervisely-dev.deepsystems.io/h5un6l2bnaz1vj8a9qgms4-public/images/original/k/6/3r/M7uD41QMNo4vdBn0ghawUhBnuS7kVrTDBTZsUtqSNVTBXNYVbkcmYbxOim78mDJuJq7AmtBNl42IUQmcSCWYrKn4sGuSF5aGqP5o8likSyiQSjE8akrHObKqzxax.png', 'imageHash': 'Krji9khnu2H/+wSXit6F1ybt96Zfu7bU1dhelIosgFs=', 'imageSize': [1008, 756], 'datasetName': 'Train', 'positivePoints': [], 'negativePoints': [], 'originalBbox': [[177, 178], [407, 467]], 'scaledBbox': [[171, 170], [413, 475]], 'mask': null, 'isActive': true, 'slyId': 58030159, 'needsAnUpdate': false}}}}

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
