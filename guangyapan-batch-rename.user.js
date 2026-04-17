// ==UserScript==
// @name         光鸭云盘批量助手 V4
// @namespace    serenalee.guangyapan.batch-helper
// @version      0.5.30
// @description  为光鸭云盘网页端提供批量重命名、重复项预览/勾选/删除、移动整理、TXT/JSON 磁力批量云添加、最里层空目录扫描与删除、进度显示与滚动列表累计识别功能。
// @author       Serena Lee
// @license      Copyright (c) 2026 Serena Lee. All rights reserved.
// @match        https://www.guangyapan.com/*
// @icon         https://image.868717.xyz/file/1776301692011_3.svg
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.guangyapan.com
// @downloadURL https://update.greasyfork.org/scripts/574046/%E5%85%89%E9%B8%AD%E4%BA%91%E7%9B%98%E6%89%B9%E9%87%8F%E5%8A%A9%E6%89%8B%20V4.user.js
// @updateURL https://update.greasyfork.org/scripts/574046/%E5%85%89%E9%B8%AD%E4%BA%91%E7%9B%98%E6%89%B9%E9%87%8F%E5%8A%A9%E6%89%8B%20V4.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.5.30';

  // =========================
  // 用户配置区：主要改这里
  // =========================
  const CONFIG = {
    debug: false,
    request: {
      apiHost: 'https://api.guangyapan.com',
      listPath: '/nd.bizuserres.s/v1/file/get_file_list',
      renamePath: '/nd.bizuserres.s/v1/file/rename',
      deletePath: '/nd.bizuserres.s/v1/file/delete_file',
      movePath: '/nd.bizuserres.s/v1/file/move_file',
      createDirPath: '/nd.bizuserres.s/v1/file/create_dir',
      taskStatusPath: '/nd.bizuserres.s/v1/get_task_status',
      resolveResPath: '/nd.bizcloudcollection.s/v1/resolve_res',
      cloudCreateTaskPath: '/nd.bizcloudcollection.s/v1/create_task',
      cloudListTaskPath: '/nd.bizcloudcollection.s/v1/list_task',
      // 自动抓不到时，再手工填写这些值。
      manualHeaders: {
        authorization: '',
        did: '',
        dt: '',
        appid: '',
        timestamp: '',
        signature: '',
        nonce: '',
      },
      // 自动抓不到当前目录时，再手工填写。
      manualListBody: {
        parentId: '',
        pageSize: 100,
        orderBy: 0,
        sortType: 0,
      },
    },
    batch: {
      delayMs: 300,
      confirmBeforeRun: true,
      stopOnError: false,
      taskPollMs: 1500,
      taskPollMaxTries: 180,
    },
    rename: {
      ruleMode: 'remove-leading-bracket',
      // 默认效果：删除开头第一个 [] 或 【】 以及里面的内容。
      // 可按顺序继续加规则。
      rules: [
        {
          enabled: true,
          type: 'regex',
          pattern: '^\\s*[\\[【][^\\]】]*[\\]】]\\s*',
          flags: 'u',
          replace: '',
        },
      ],
      output: {
        mode: 'keep-clean',
        addText: '',
        addPosition: 'suffix',
        findText: '',
        replaceText: '',
        formatStyle: 'text-and-index',
        formatText: '文件',
        formatPosition: 'suffix',
        startIndex: 0,
        template: '{clean}',
      },
      // 可用占位符：
      // {original} 原文件名
      // {clean}    应用 rules 后的名字
      // {base}     clean 去掉最后一个扩展名后的部分
      // {ext}      clean 的最后一个扩展名，例：.mkv
      // {fileId}   文件 ID
      // {index}    序号（格式命名或自定义模板时可用）
      template: '{clean}',
      trimResult: true,
      buildName(item, utils, context = {}) {
        const original = String(item.name || '');
        const clean = utils.applyRules(original, item);
        const ext = utils.getExt(clean);
        const base = utils.getBaseName(clean);
        const output = CONFIG.rename.output || {};
        const mode = output.mode || 'keep-clean';
        const renameIndex = Number(context.renameIndex || 0);
        const serial = Number(output.startIndex || 0) + renameIndex;

        if (mode === 'add-text') {
          const addText = String(output.addText || '');
          if (!addText) {
            return clean;
          }
          return output.addPosition === 'prefix' ? `${addText}${clean}` : `${clean}${addText}`;
        }

        if (mode === 'replace-text') {
          const findText = String(output.findText || '');
          if (!findText) {
            return clean;
          }
          return clean.split(findText).join(String(output.replaceText || ''));
        }

        if (mode === 'format') {
          const formatText = String(output.formatText || '').trim() || '文件';
          if (output.formatStyle === 'text-only') {
            return formatText;
          }
          return output.formatPosition === 'prefix' ? `${serial}${formatText}` : `${formatText}${serial}`;
        }

        if (mode === 'custom-template') {
          const template = String(output.template || CONFIG.rename.template || '{clean}').trim() || '{clean}';
          return utils.renderTemplate(template, {
            original,
            clean,
            base,
            ext,
            fileId: item.fileId,
            index: serial,
          });
        }

        return clean;
      },
    },
    filter: {
      // 想跳过某些名字时在这里写条件。
      // 例：item => !item.name.includes('不要改')
      predicate: () => true,
    },
    duplicate: {
      mode: 'numbers',
      numbers: '1,2,3',
      // 默认识别文件夹名末尾带 (1) / (2) / (3) 或中文括号版本。
      pattern: '[（(]\\s*(?:1|2|3|１|２|３)\\s*[）)]\\s*(?:\\.[a-zA-Z0-9]{1,12})?$',
      flags: 'u',
    },
    cloud: {
      maxFilesPerTask: 500,
      sourceDirPrefix: '磁力导入',
      createMagnetSubdir: false,
      listTaskPageSize: 50,
    },
    move: {
      targetParentId: '',
      batchSize: 20,
    },
  };

  const LOG_PREFIX = '[光鸭云盘批量助手]';
  const CAPTURE_EVENT = '__GYP_BATCH_RENAME_CAPTURE__';
  const PAGE_REQUEST_EVENT = '__GYP_BATCH_RENAME_PAGE_REQUEST__';
  const PAGE_RESPONSE_EVENT = '__GYP_BATCH_RENAME_PAGE_RESPONSE__';
  const CONFIG_STORAGE_KEY = '__GYP_BATCH_RENAME_CONFIG_V1__';
  const STATE = {
    headers: {},
    lastApiHeaders: null,
    lastListHeaders: null,
    lastListUrl: '',
    lastListBody: null,
    lastListItems: [],
    capturedLists: {},
    lastCapturedParentId: '',
    lastItemsSource: 'none',
    lastListResponse: null,
    lastListCapturedAt: 0,
    lastRenameRequest: null,
    duplicatePreviewItems: [],
    duplicateSelection: {},
    moveSelectionPreviewItems: [],
    moveSelectionExpectedCount: 0,
    moveSelectionSource: 'visible',
    moveSelectionWarning: '',
    emptyDirSelection: {},
    magnetImportFiles: [],
    lastCloudImportSummary: null,
    lastCloudTaskList: null,
    lastEmptyDirScan: null,
    activeTaskControl: null,
    lastProgressState: {
      visible: false,
      percent: 0,
      indeterminate: false,
      text: '',
    },
    installedAt: new Date().toISOString(),
  };
  const UI = {
    root: null,
    panel: null,
    mini: null,
    status: null,
    progressWrap: null,
    progressBar: null,
    progressText: null,
    pauseTaskButton: null,
    stopTaskButton: null,
    fields: {},
    summary: null,
    duplicateDetails: null,
    duplicateList: null,
    duplicateCount: null,
    moveDetails: null,
    moveSelectionList: null,
    moveSelectionCount: null,
    emptyDirList: null,
    emptyDirCount: null,
    emptyDirDetails: null,
    magnetDetails: null,
    magnetFileInput: null,
    magnetFileList: null,
    magnetFileCount: null,
  };

  const KEEP_HEADER_NAMES = [
    'authorization',
    'did',
    'dt',
  ];
  const FORBIDDEN_FORWARD_HEADERS = new Set([
    'accept-encoding',
    'content-length',
    'cookie',
    'host',
    'origin',
    'priority',
    'referer',
  ]);
  const SAFE_FORWARD_HEADERS = new Set([
    'accept',
    'authorization',
    'content-type',
    'did',
    'dt',
    'x-device-id',
    'x-requested-with',
  ]);
  const DEFAULT_LEADING_BRACKET_PATTERN = '^\\s*[\\[【][^\\]】]*[\\]】]\\s*';
  const DEFAULT_DUPLICATE_NUMBERS = '1,2,3';
  const EMPTY_STATE_TEXT_PATTERNS = [
    /暂无文件/u,
    /空文件夹/u,
    /暂无数据/u,
    /文件夹为空/u,
    /没有文件/u,
    /这里空空如也/u,
    /什么都没有/u,
  ];
  const ROOT_DIRECTORY_NAMES = new Set([
    '我的云盘',
    '首页',
    '全部文件',
    '光鸭云盘',
    '文件',
  ]);
  const TRANSIENT_LIST_BODY_KEYS = new Set([
    'cursor',
    'nextCursor',
    'nextKey',
    'nextToken',
    'pageToken',
    'continueToken',
    'marker',
    'offset',
    'start',
    'startId',
    'startKey',
    'lastId',
    'lastKey',
    'lastFileId',
    'lastSortValue',
    'pageNo',
    'pageNum',
    'pageIndex',
    'page',
    'scrollId',
  ]);
  const KNOWN_COMPOUND_FILE_EXTENSIONS = [
    '.tar.gz',
    '.tar.bz2',
    '.tar.xz',
    '.user.js',
    '.d.ts',
  ];
  const KNOWN_FILE_EXTENSIONS = new Set([
    '7z',
    'aac',
    'ape',
    'ass',
    'avi',
    'azw3',
    'bmp',
    'bz2',
    'csv',
    'cue',
    'doc',
    'docx',
    'epub',
    'flac',
    'flv',
    'gif',
    'gz',
    'heic',
    'idx',
    'iso',
    'jpeg',
    'jpg',
    'json',
    'm4a',
    'm4v',
    'mkv',
    'mobi',
    'mov',
    'mp3',
    'mp4',
    'mpeg',
    'mpg',
    'mtv',
    'nfo',
    'ogg',
    'opus',
    'pdf',
    'png',
    'ppt',
    'pptx',
    'rar',
    'rm',
    'rmvb',
    'srt',
    'ssa',
    'strm',
    'sub',
    'sup',
    'tar',
    'tif',
    'tiff',
    'torrent',
    'ts',
    'txt',
    'vtt',
    'wav',
    'webm',
    'webp',
    'wmv',
    'xls',
    'xlsx',
    'xml',
    'xz',
    'yaml',
    'yml',
    'zip',
  ]);
  const CLOUD_VIDEO_EXTENSIONS = new Set([
    '3gp',
    'asf',
    'avi',
    'flv',
    'iso',
    'm2ts',
    'm4v',
    'mkv',
    'mov',
    'mp4',
    'mpeg',
    'mpg',
    'mtv',
    'rm',
    'rmvb',
    'ts',
    'vob',
    'webm',
    'wmv',
  ]);
  const CLOUD_JUNK_EXTENSIONS = new Set([
    'bmp',
    'gif',
    'jpeg',
    'jpg',
    'nfo',
    'png',
    'txt',
    'url',
    'webp',
  ]);
  const CLOUD_SKIP_NAME_PATTERNS = [
    /(^|[^\w])(sample|trailer|teaser|preview|screencap|poster|cover)([^\w]|$)/i,
    /预告|花絮|海报|封面|说明|访问|网址/i,
  ];
  const EMPTY_DIR_SCAN_MAX_DIRS = 3000;
  const EMPTY_DIR_SCAN_MAX_PAGES_PER_DIR = 200;
  const EMPTY_SCAN_EXTRA_FILE_EXTENSIONS = new Set([
    'apk',
    'cia',
    'ipa',
    'nsp',
    'nsz',
    'pkg',
    'xci',
    'xcz',
  ]);

  function getForwardableHeadersFromCaptured(headersLike) {
    const captured = sanitizeHeaders(headersLike);
    const forwardable = {};

    for (const [key, value] of Object.entries(captured)) {
      if (
        !key ||
        key.startsWith(':') ||
        key.startsWith('sec-') ||
        FORBIDDEN_FORWARD_HEADERS.has(key) ||
        !SAFE_FORWARD_HEADERS.has(key)
      ) {
        continue;
      }
      forwardable[key] = value;
    }

    return forwardable;
  }

  function pickFirstNonEmptyHeaders(...sources) {
    for (const source of sources) {
      if (source && Object.keys(sanitizeHeaders(source)).length) {
        return source;
      }
    }
    return null;
  }

  function log(...args) {
    if (CONFIG.debug) {
      console.log(LOG_PREFIX, ...args);
    }
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function fail(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeJsonParse(value) {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function loadPersistedConfig() {
    try {
      const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        if (saved.manualHeaders && typeof saved.manualHeaders === 'object') {
          Object.assign(CONFIG.request.manualHeaders, saved.manualHeaders);
        }
        if (saved.manualListBody && typeof saved.manualListBody === 'object') {
          Object.assign(CONFIG.request.manualListBody, saved.manualListBody);
        }
        if (saved.batch && typeof saved.batch === 'object') {
          if (saved.batch.delayMs != null && !Number.isNaN(Number(saved.batch.delayMs))) {
            CONFIG.batch.delayMs = Number(saved.batch.delayMs);
          }
        }
        if (typeof saved.renameTemplate === 'string') {
          CONFIG.rename.template = saved.renameTemplate;
        }
        if (typeof saved.renameRuleMode === 'string') {
          CONFIG.rename.ruleMode = saved.renameRuleMode;
        }
        if (saved.renameOutput && typeof saved.renameOutput === 'object') {
          Object.assign(CONFIG.rename.output, saved.renameOutput);
        }
        if (saved.firstRule && typeof saved.firstRule === 'object' && CONFIG.rename.rules[0]) {
          Object.assign(CONFIG.rename.rules[0], saved.firstRule);
        }
        if (saved.duplicate && typeof saved.duplicate === 'object') {
          if (typeof saved.duplicate.mode === 'string') {
            CONFIG.duplicate.mode = saved.duplicate.mode;
          }
          if (typeof saved.duplicate.numbers === 'string') {
            CONFIG.duplicate.numbers = saved.duplicate.numbers;
          }
          if (typeof saved.duplicate.pattern === 'string') {
            CONFIG.duplicate.pattern = saved.duplicate.pattern;
          }
          if (typeof saved.duplicate.flags === 'string') {
            CONFIG.duplicate.flags = saved.duplicate.flags;
          }
        }
        if (saved.cloud && typeof saved.cloud === 'object') {
          if (saved.cloud.maxFilesPerTask != null && !Number.isNaN(Number(saved.cloud.maxFilesPerTask))) {
            CONFIG.cloud.maxFilesPerTask = Math.max(1, Number(saved.cloud.maxFilesPerTask));
          }
          if (typeof saved.cloud.sourceDirPrefix === 'string') {
            CONFIG.cloud.sourceDirPrefix = saved.cloud.sourceDirPrefix;
          }
          if (typeof saved.cloud.createMagnetSubdir === 'boolean') {
            CONFIG.cloud.createMagnetSubdir = saved.cloud.createMagnetSubdir;
          }
          if (saved.cloud.listTaskPageSize != null && !Number.isNaN(Number(saved.cloud.listTaskPageSize))) {
            CONFIG.cloud.listTaskPageSize = Math.max(1, Number(saved.cloud.listTaskPageSize));
          }
        }
        if (saved.move && typeof saved.move === 'object') {
          if (typeof saved.move.targetParentId === 'string') {
            CONFIG.move.targetParentId = saved.move.targetParentId;
          }
          if (saved.move.batchSize != null && !Number.isNaN(Number(saved.move.batchSize))) {
            CONFIG.move.batchSize = Math.max(1, Number(saved.move.batchSize));
          }
        }
      }
    } catch (err) {
      warn('读取已保存配置失败：', err);
    }
  }

  function savePersistedConfig() {
    try {
      const payload = {
        manualHeaders: { ...CONFIG.request.manualHeaders },
        manualListBody: { ...CONFIG.request.manualListBody },
        batch: {
          delayMs: CONFIG.batch.delayMs,
        },
        renameTemplate: CONFIG.rename.template,
        renameRuleMode: CONFIG.rename.ruleMode,
        renameOutput: { ...CONFIG.rename.output },
        firstRule: CONFIG.rename.rules[0]
          ? {
              enabled: CONFIG.rename.rules[0].enabled !== false,
              type: CONFIG.rename.rules[0].type || 'regex',
              pattern: CONFIG.rename.rules[0].pattern || '',
              flags: CONFIG.rename.rules[0].flags || '',
              search: CONFIG.rename.rules[0].search || '',
              replace: CONFIG.rename.rules[0].replace || '',
            }
          : null,
        duplicate: {
          mode: CONFIG.duplicate.mode,
          numbers: CONFIG.duplicate.numbers,
          pattern: CONFIG.duplicate.pattern,
          flags: CONFIG.duplicate.flags,
        },
        cloud: {
          maxFilesPerTask: CONFIG.cloud.maxFilesPerTask,
          sourceDirPrefix: CONFIG.cloud.sourceDirPrefix,
          createMagnetSubdir: CONFIG.cloud.createMagnetSubdir,
          listTaskPageSize: CONFIG.cloud.listTaskPageSize,
        },
        move: {
          targetParentId: CONFIG.move.targetParentId,
          batchSize: CONFIG.move.batchSize,
        },
      };
      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      warn('保存配置失败：', err);
    }
  }

  function sanitizeHeaders(headersLike) {
    const out = {};
    if (!headersLike) {
      return out;
    }

    if (headersLike instanceof Headers) {
      for (const [key, value] of headersLike.entries()) {
        out[String(key).toLowerCase()] = value;
      }
      return out;
    }

    if (Array.isArray(headersLike)) {
      for (const [key, value] of headersLike) {
        out[String(key).toLowerCase()] = value;
      }
      return out;
    }

    if (typeof headersLike === 'object') {
      for (const [key, value] of Object.entries(headersLike)) {
        out[String(key).toLowerCase()] = value;
      }
    }
    return out;
  }

  function mergeHeaders(headersLike) {
    const normalized = sanitizeHeaders(headersLike);
    for (const key of KEEP_HEADER_NAMES) {
      if (normalized[key]) {
        STATE.headers[key] = normalized[key];
      }
    }
  }

  function getMergedHeaders() {
    const out = {};
    const manual = CONFIG.request.manualHeaders || {};

    for (const key of KEEP_HEADER_NAMES) {
      // 优先使用最新的 STATE (捕获到的)，如果没有，再用 manual (保存的)
      out[key] = STATE.headers[key] || manual[key] || '';
    }
    return out;
  }

  function normalizeParentId(value) {
    return String(value || '').trim();
  }

  function getParentIdFromListBody(body) {
    return normalizeParentId(body && typeof body === 'object' ? body.parentId : '');
  }

  function sanitizeListBody(body = {}) {
    const source = body && typeof body === 'object' ? body : {};
    const out = {};

    for (const [key, value] of Object.entries(source)) {
      if (value === '' || value == null) {
        continue;
      }
      if (TRANSIENT_LIST_BODY_KEYS.has(String(key))) {
        continue;
      }
      out[key] = value;
    }

    return out;
  }

  function getCapturedItemKey(item) {
    if (!item || typeof item !== 'object') {
      return '';
    }

    const fileId = String(item.fileId || '').trim();
    if (fileId) {
      return `id:${fileId}`;
    }

    const name = normalizeDomName(item.name);
    return name ? `name:${name}` : '';
  }

  function createCapturedListBucket(parentId) {
    return {
      parentId,
      items: [],
      indexByKey: {},
      batchCount: 0,
      lastBatchSize: 0,
      listUrl: '',
      lastBody: null,
      updatedAt: '',
    };
  }

  function getCapturedListBucket(parentId, options = {}) {
    const key = normalizeParentId(parentId);
    if (!key) {
      return null;
    }

    if (!STATE.capturedLists[key] && options.create !== false) {
      STATE.capturedLists[key] = createCapturedListBucket(key);
    }
    return STATE.capturedLists[key] || null;
  }

  function rebuildCapturedListBucketIndex(bucket) {
    if (!bucket || !Array.isArray(bucket.items)) {
      return;
    }

    const next = {};
    const deduped = [];
    for (const item of bucket.items) {
      const itemKey = getCapturedItemKey(item);
      if (!itemKey || Object.prototype.hasOwnProperty.call(next, itemKey)) {
        continue;
      }
      next[itemKey] = deduped.length;
      deduped.push(item);
    }

    bucket.items = deduped;
    bucket.indexByKey = next;
  }

  function mergeCapturedItems(parentId, items, meta = {}) {
    const normalizedParentId = normalizeParentId(parentId);
    const normalizedItems = dedupeItems(
      (items || []).map((item) => ({
        fileId: String(item?.fileId || ''),
        dirId: String(item?.dirId || item?.fileId || ''),
        dirIdCandidates: normalizeIdCandidates(item?.dirIdCandidates || [item?.dirId, item?.fileId]),
        name: String(item?.name || ''),
        parentId: String(item?.parentId || ''),
        isDir: item?.isDir === true,
        raw: item?.raw,
      }))
    );

    if (!normalizedParentId) {
      STATE.lastListItems = normalizedItems;
      STATE.lastItemsSource = 'api';
      return {
        items: normalizedItems,
        total: normalizedItems.length,
        added: normalizedItems.length,
        updated: 0,
        batchCount: normalizedItems.length ? 1 : 0,
        lastBatchSize: normalizedItems.length,
        parentId: '',
      };
    }

    const bucket = getCapturedListBucket(normalizedParentId);
    let added = 0;
    let updated = 0;

    for (const item of normalizedItems) {
      const itemKey = getCapturedItemKey(item);
      if (!itemKey) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(bucket.indexByKey, itemKey)) {
        bucket.items[bucket.indexByKey[itemKey]] = item;
        updated += 1;
      } else {
        bucket.indexByKey[itemKey] = bucket.items.length;
        bucket.items.push(item);
        added += 1;
      }
    }

    if (meta.countAsBatch !== false) {
      bucket.batchCount += 1;
    }
    bucket.lastBatchSize = normalizedItems.length;
    bucket.updatedAt = new Date().toISOString();
    if (meta.listUrl) {
      bucket.listUrl = String(meta.listUrl);
    }
    if (meta.requestBody && typeof meta.requestBody === 'object') {
      bucket.lastBody = { ...meta.requestBody };
    }

    STATE.lastCapturedParentId = normalizedParentId;
    STATE.lastListItems = bucket.items;
    STATE.lastItemsSource = bucket.batchCount > 1 ? 'api-merged' : 'api';

    return {
      items: bucket.items,
      total: bucket.items.length,
      added,
      updated,
      batchCount: bucket.batchCount,
      lastBatchSize: bucket.lastBatchSize,
      parentId: normalizedParentId,
    };
  }

  function removeCapturedItemsByIds(fileIds) {
    const ids = new Set((fileIds || []).map((id) => String(id)).filter(Boolean));
    if (!ids.size) {
      return;
    }

    for (const bucket of Object.values(STATE.capturedLists || {})) {
      if (!bucket || !Array.isArray(bucket.items) || !bucket.items.length) {
        continue;
      }
      bucket.items = bucket.items.filter((item) => !ids.has(String(item.fileId || '')));
      rebuildCapturedListBucketIndex(bucket);
    }

    const currentBucket = getCapturedListBucket(STATE.lastCapturedParentId, { create: false });
    if (currentBucket) {
      STATE.lastListItems = currentBucket.items;
    }
  }

  function renameCapturedItem(fileId, newName) {
    const id = String(fileId || '').trim();
    if (!id) {
      return;
    }

    for (const bucket of Object.values(STATE.capturedLists || {})) {
      if (!bucket || !Array.isArray(bucket.items) || !bucket.items.length) {
        continue;
      }
      const index = bucket.indexByKey[`id:${id}`];
      if (typeof index === 'number' && bucket.items[index]) {
        bucket.items[index] = {
          ...bucket.items[index],
          name: String(newName || ''),
        };
      }
    }
  }

  function getCapturedListStats(parentId = '') {
    const normalizedParentId =
      normalizeParentId(parentId) ||
      getParentIdFromListBody(STATE.lastListBody) ||
      normalizeParentId(CONFIG.request.manualListBody.parentId) ||
      normalizeParentId(STATE.lastCapturedParentId);
    const bucket = getCapturedListBucket(normalizedParentId, { create: false });
    const fallbackItems = Array.isArray(STATE.lastListItems) ? STATE.lastListItems : [];

    return {
      parentId: normalizedParentId,
      total: bucket?.items?.length || fallbackItems.length || 0,
      lastBatchSize: bucket?.lastBatchSize || fallbackItems.length || 0,
      batchCount: bucket?.batchCount || (fallbackItems.length ? 1 : 0),
      listUrl: bucket?.listUrl || STATE.lastListUrl || '',
      updatedAt: bucket?.updatedAt || '',
    };
  }

  function getItemsSourceLabel(source = STATE.lastItemsSource) {
    if (source === 'api-merged') {
      return 'api(累计)';
    }
    if (source === 'dom') {
      return '页面可见项';
    }
    return source || 'none';
  }

  function getCurrentListContext() {
    const stats = getCapturedListStats();
    const bucket = getCapturedListBucket(stats.parentId, { create: false });
    const body = resolveListBody(bucket?.lastBody || STATE.lastListBody || {});
    return {
      parentId: body.parentId || stats.parentId || '',
      pageSize: body.pageSize || '',
      listUrl: stats.listUrl || '',
      capturedCount: stats.total,
      lastBatchSize: stats.lastBatchSize,
      batchCount: stats.batchCount,
    };
  }

  function getRequestHeaders() {
    const extra = getMergedHeaders();
    const captured = getForwardableHeadersFromCaptured(
      pickFirstNonEmptyHeaders(STATE.lastApiHeaders, STATE.lastListHeaders, STATE.lastRenameRequest?.headers)
    );
    return {
      ...captured,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      ...extra,
    };
  }

  function pickExistingKey(obj, candidates, fallback) {
    if (!obj || typeof obj !== 'object') {
      return fallback;
    }
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        return key;
      }
    }
    return fallback;
  }

  function getRenameUrl() {
    return STATE.lastRenameRequest?.url || `${CONFIG.request.apiHost}${CONFIG.request.renamePath}`;
  }

  function getDeleteUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.deletePath}`;
  }

  function getMoveUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.movePath}`;
  }

  function getCreateDirUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.createDirPath}`;
  }

  function getTaskStatusUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.taskStatusPath}`;
  }

  function getResolveResUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.resolveResPath}`;
  }

  function getCloudCreateTaskUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.cloudCreateTaskPath}`;
  }

  function getCloudListTaskUrl() {
    return `${CONFIG.request.apiHost}${CONFIG.request.cloudListTaskPath}`;
  }

  function getRenameHeaders() {
    const forwardable = getForwardableHeadersFromCaptured(
      pickFirstNonEmptyHeaders(STATE.lastRenameRequest?.headers, STATE.lastApiHeaders, STATE.lastListHeaders)
    );
    return {
      ...forwardable,
      ...getRequestHeaders(),
    };
  }

  function getCommonApiRequestOptions(body, headers = getRequestHeaders()) {
    return {
      method: 'POST',
      headers,
      mode: 'cors',
      credentials: 'include',
      body: JSON.stringify(body),
    };
  }

  async function postJson(url, body, headers = getRequestHeaders()) {
    const response = await pageRequest(url, getCommonApiRequestOptions(body, headers));
    const payload = safeJsonParse(response.text || '');
    return {
      ok: response.ok,
      status: response.status,
      text: response.text || '',
      payload,
    };
  }

  function findFirstValueByKeys(node, keys) {
    if (!node || typeof node !== 'object') {
      return null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findFirstValueByKeys(item, keys);
        if (found != null) {
          return found;
        }
      }
      return null;
    }

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(node, key) && node[key] != null) {
        return node[key];
      }
    }

    for (const value of Object.values(node)) {
      const found = findFirstValueByKeys(value, keys);
      if (found != null) {
        return found;
      }
    }

    return null;
  }

  function decodeUrlParam(value) {
    try {
      return decodeURIComponent(String(value || '').replace(/\+/g, '%20'));
    } catch {
      return String(value || '');
    }
  }

  function getMagnetQueryParams(magnetUrl) {
    const text = String(magnetUrl || '').trim();
    const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : '';
    return new URLSearchParams(query);
  }

  function getMagnetBtih(magnetUrl) {
    const xt = getMagnetQueryParams(magnetUrl).get('xt') || '';
    const matched = xt.match(/btih:([^&]+)/i);
    return matched ? String(matched[1] || '').trim() : '';
  }

  function getMagnetDisplayName(magnetUrl) {
    const params = getMagnetQueryParams(magnetUrl);
    const dn = params.get('dn');
    if (dn) {
      return decodeUrlParam(dn);
    }
    const btih = getMagnetBtih(magnetUrl);
    return btih ? `磁力_${btih.slice(0, 12)}` : '磁力资源';
  }

  function getMagnetIdentityKey(magnetUrl) {
    const btih = String(getMagnetBtih(magnetUrl) || '').trim().toLowerCase();
    if (btih) {
      return `btih:${btih}`;
    }
    const normalizedUrl = String(magnetUrl || '').trim().toLowerCase();
    return normalizedUrl ? `url:${normalizedUrl}` : '';
  }

  function sanitizeCloudDirName(name, fallback = '磁力资源') {
    const text = String(name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const normalized = text || fallback;
    return normalized.length > 96 ? normalized.slice(0, 96).trim() : normalized;
  }

  function buildTimestampToken(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hour}${minute}${second}`;
  }

  function stripGenericExtension(name) {
    return String(name || '').replace(/\.[^.]+$/, '') || String(name || '');
  }

  function chunkArray(items, chunkSize) {
    const size = Math.max(1, Number(chunkSize || 1));
    const source = Array.isArray(items) ? items : [];
    const chunks = [];
    for (let index = 0; index < source.length; index += size) {
      chunks.push(source.slice(index, index + size));
    }
    return chunks;
  }

  function extractCreatedDirId(payload) {
    const value = findFirstValueByKeys(payload, ['dirId', 'dir_id', 'fileId', 'folderId', 'folder_id', 'id']);
    return value == null ? '' : String(value);
  }

  function collectObjectArrays(node, out = [], seen = new WeakSet()) {
    if (!node || typeof node !== 'object') {
      return out;
    }
    if (seen.has(node)) {
      return out;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length && node.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
        out.push(node);
      }
      for (const item of node) {
        collectObjectArrays(item, out, seen);
      }
      return out;
    }

    for (const value of Object.values(node)) {
      collectObjectArrays(value, out, seen);
    }
    return out;
  }

  function normalizeResolvedFileEntry(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return null;
    }

    const strongIndex = toFiniteNumberOrNull(
      obj.fileIndex ?? obj.file_index ?? obj.fileNo ?? obj.file_no
    );
    const weakIndex = toFiniteNumberOrNull(
      obj.index ?? obj.idx ?? obj.seq
    );
    const index = strongIndex ?? weakIndex;
    if (index == null || index < 0) {
      return null;
    }

    const name = chooseBestNameCandidate([
      obj.name,
      obj.fileName,
      obj.file_name,
      obj.filename,
      obj.path,
      obj.filePath,
      obj.file_path,
      obj.fullPath,
      obj.full_path,
      obj.resName,
      obj.resourceName,
      obj.title,
    ]);

    if (
      strongIndex == null
      && !(
        name
        && !Object.values(obj).some((value) => Array.isArray(value) && value.some((item) => item && typeof item === 'object'))
      )
    ) {
      return null;
    }

    return {
      index,
      name,
      raw: obj,
      fromExplicitIndex: strongIndex != null,
    };
  }

  function scanResolvedFileEntries(node, out = [], seen = new WeakSet()) {
    if (!node || typeof node !== 'object') {
      return out;
    }
    if (seen.has(node)) {
      return out;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        scanResolvedFileEntries(item, out, seen);
      }
      return out;
    }

    const normalized = normalizeResolvedFileEntry(node);
    if (normalized) {
      out.push(normalized);
    }

    for (const value of Object.values(node)) {
      scanResolvedFileEntries(value, out, seen);
    }
    return out;
  }

  function parseSizeLikeBytes(value) {
    if (value == null || value === '') {
      return 0;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : 0;
    }

    const text = String(value || '').trim();
    if (!text) {
      return 0;
    }
    if (/^\d+$/u.test(text)) {
      const numeric = Number(text);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }

    const matched = text.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)$/iu);
    if (!matched) {
      return 0;
    }

    const number = Number(matched[1] || 0);
    const unit = String(matched[2] || 'B').toUpperCase();
    const scales = {
      B: 1,
      KB: 1024,
      MB: 1024 ** 2,
      GB: 1024 ** 3,
      TB: 1024 ** 4,
      PB: 1024 ** 5,
    };
    return Number.isFinite(number) && number > 0 ? number * (scales[unit] || 1) : 0;
  }

  function getResolvedEntrySizeBytes(entry) {
    const source = entry?.raw && typeof entry.raw === 'object' ? entry.raw : (entry && typeof entry === 'object' ? entry : {});
    const keys = [
      'size',
      'fileSize',
      'file_size',
      'contentLength',
      'content_length',
      'byteSize',
      'byte_size',
      'bytes',
    ];

    for (const key of keys) {
      const bytes = parseSizeLikeBytes(source[key]);
      if (bytes > 0) {
        return bytes;
      }
    }

    return 0;
  }

  function isLikelyResolvedLabelOnlyName(name = '') {
    const text = normalizeDomName(name).toLowerCase();
    if (!text) {
      return false;
    }

    return /^(视频|图片|其他|全部|全选|文件|文件名称|格式|大小|movie|movies|video|videos|image|images|other|others|all|selected|\d+\s*项)$/iu.test(text);
  }

  function isLikelyResolvedFileName(name = '') {
    const text = normalizeDomName(name);
    if (!text || isLikelyResolvedLabelOnlyName(text)) {
      return false;
    }

    const ext = getResolvedEntryExt({ name: text });
    if (ext && (KNOWN_FILE_EXTENSIONS.has(ext) || CLOUD_VIDEO_EXTENSIONS.has(ext) || CLOUD_JUNK_EXTENSIONS.has(ext) || EMPTY_SCAN_EXTRA_FILE_EXTENSIONS.has(ext))) {
      return true;
    }

    return /[\\/]/.test(text) || /\.[a-z0-9]{1,12}$/i.test(text);
  }

  function scoreResolvedEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return -1000;
    }

    const name = String(entry.name || '').trim();
    const ext = getResolvedEntryExt(entry);
    const sizeBytes = getResolvedEntrySizeBytes(entry);
    let score = 0;

    if (name) {
      score += Math.min(40, name.length);
    } else {
      score -= 40;
    }

    if (isLikelyResolvedFileName(name)) {
      score += 140;
    }
    if (ext) {
      score += 45;
    }
    if (ext && KNOWN_FILE_EXTENSIONS.has(ext)) {
      score += 80;
    }
    if (ext && EMPTY_SCAN_EXTRA_FILE_EXTENSIONS.has(ext)) {
      score += 80;
    }
    if (ext && CLOUD_VIDEO_EXTENSIONS.has(ext)) {
      score += 140;
    }
    if (sizeBytes > 0) {
      score += 120 + Math.min(140, Math.round((Math.log(sizeBytes + 1) / Math.log(1024)) * 35));
    }
    if (entry.fromExplicitIndex) {
      score += 25;
    }
    if (hasPositiveSizeLikeField(entry.raw)) {
      score += 30;
    }
    if (isLikelyJunkResolvedEntry(entry)) {
      score -= 12;
    }
    if (isLikelyResolvedLabelOnlyName(name)) {
      score -= 320;
    }

    return score;
  }

  function dedupeResolvedEntriesByIndex(entries) {
    const byIndex = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || !Number.isFinite(Number(entry.index))) {
        continue;
      }
      const index = Number(entry.index);
      const previous = byIndex.get(index);
      if (!previous || scoreResolvedEntry(entry) > scoreResolvedEntry(previous)) {
        byIndex.set(index, {
          ...entry,
          index,
        });
      }
    }
    return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  }

  function buildPositionalResolvedEntries(arr) {
    return dedupeResolvedEntriesByIndex(
      (Array.isArray(arr) ? arr : [])
        .map((item, index) => {
          const name = chooseBestNameCandidate([
            item?.name,
            item?.fileName,
            item?.file_name,
            item?.filename,
            item?.path,
            item?.filePath,
            item?.file_path,
            item?.fullPath,
            item?.full_path,
            item?.resName,
            item?.resourceName,
            item?.title,
          ]);
          if (!name) {
            return null;
          }
          return {
            index,
            name,
            raw: item,
            fromExplicitIndex: false,
          };
        })
        .filter(Boolean)
    );
  }

  function isLikelyResolvedFileArrayKey(key = '') {
    const text = String(key || '').trim().toLowerCase();
    if (!text) {
      return false;
    }

    return /^(data|list|items|rows|records|files|filelist|file_list|fileinfos|file_infos|fileinfo|children|result|results|reslist|resource_list|resourcelist)$/i.test(text)
      || /(file|files|item|items|row|rows|record|records|result|results|child|children|resource)s?$/i.test(text);
  }

  function scoreResolvedFileCandidate(entries, meta = {}) {
    const normalized = dedupeResolvedEntriesByIndex(entries);
    if (!normalized.length) {
      return Number.NEGATIVE_INFINITY;
    }

    const namedCount = normalized.filter((entry) => String(entry.name || '').trim()).length;
    const fileLikeCount = normalized.filter((entry) => isLikelyResolvedFileName(entry.name || '')).length;
    const sizeCount = normalized.filter((entry) => getResolvedEntrySizeBytes(entry) > 0).length;
    const videoCount = normalized.filter((entry) => isLikelyVideoResolvedEntry(entry)).length;
    const labelOnlyCount = normalized.filter((entry) => isLikelyResolvedLabelOnlyName(entry.name || '')).length;
    const explicitCount = normalized.filter((entry) => entry.fromExplicitIndex).length;
    const lastKey = String((meta.pathKeys || [])[Math.max(0, (meta.pathKeys || []).length - 1)] || '').trim();
    const likelyKey = isLikelyResolvedFileArrayKey(lastKey);
    const pathBonus = Array.isArray(meta.pathKeys) && meta.pathKeys.some((key) => isLikelyResolvedFileArrayKey(key)) ? 120 : 0;
    const dataBonus = Array.isArray(meta.pathKeys) && meta.pathKeys[0] === 'data' ? 30 : 0;
    const entryScore = normalized.reduce((sum, entry) => sum + Math.max(-200, scoreResolvedEntry(entry)), 0);

    let score = entryScore;
    score += normalized.length * 22;
    score += namedCount * 15;
    score += fileLikeCount * 80;
    score += sizeCount * 110;
    score += videoCount * 100;
    score += explicitCount * 18;
    score += pathBonus + dataBonus + (likelyKey ? 160 : 0);

    if (labelOnlyCount === normalized.length) {
      score -= 900;
    } else {
      score -= labelOnlyCount * 180;
    }

    return score;
  }

  function collectResolvedFileEntryCandidates(node, out = [], options = {}) {
    const seen = options.seen || new WeakSet();
    const pathKeys = Array.isArray(options.pathKeys) ? options.pathKeys : [];
    const depth = Number(options.depth || 0);

    if (!node || typeof node !== 'object' || depth > 6) {
      return out;
    }
    if (seen.has(node)) {
      return out;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length && node.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
        const explicitEntries = dedupeResolvedEntriesByIndex(node.map((item) => normalizeResolvedFileEntry(item)).filter(Boolean));
        if (explicitEntries.length) {
          out.push({
            entries: explicitEntries,
            source: 'explicit-array',
            path: pathKeys.join('.'),
            score: scoreResolvedFileCandidate(explicitEntries, { pathKeys }),
          });
        }

        const positionalEntries = buildPositionalResolvedEntries(node);
        if (positionalEntries.length) {
          out.push({
            entries: positionalEntries,
            source: 'positional-array',
            path: pathKeys.join('.'),
            score: scoreResolvedFileCandidate(positionalEntries, { pathKeys }),
          });
        }
      }

      for (const item of node) {
        if (item && typeof item === 'object') {
          collectResolvedFileEntryCandidates(item, out, {
            seen,
            pathKeys,
            depth: depth + 1,
          });
        }
      }
      return out;
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      collectResolvedFileEntryCandidates(value, out, {
        seen,
        pathKeys: [...pathKeys, key],
        depth: depth + 1,
      });
    }
    return out;
  }

  function pickBestResolvedFileCandidate(payload) {
    const candidates = collectResolvedFileEntryCandidates(payload);
    const explicitEntries = dedupeResolvedEntriesByIndex(scanResolvedFileEntries(payload));
    if (explicitEntries.length) {
      candidates.push({
        entries: explicitEntries,
        source: 'explicit-scan',
        path: '(scan)',
        score: scoreResolvedFileCandidate(explicitEntries, { pathKeys: [] }),
      });
    }

    const explicitIndexes = findFirstValueByKeys(payload, ['fileIndexes', 'file_indexes', 'indexes']);
    if (Array.isArray(explicitIndexes) && explicitIndexes.length) {
      const entries = dedupeResolvedEntriesByIndex(
        explicitIndexes
          .map((value) => toFiniteNumberOrNull(value))
          .filter((value) => value != null)
          .map((index) => ({
            index,
            name: '',
            raw: null,
            fromExplicitIndex: true,
          }))
      );
      if (entries.length) {
        candidates.push({
          entries,
          source: 'explicit-indexes',
          path: 'fileIndexes',
          score: scoreResolvedFileCandidate(entries, { pathKeys: ['fileIndexes'] }),
        });
      }
    }

    const total = extractResolvedFileCount(payload, 0);
    if (total > 0) {
      const entries = Array.from({ length: total }, (_, index) => ({
        index,
        name: '',
        raw: null,
        fromExplicitIndex: false,
      }));
      candidates.push({
        entries,
        source: 'count-fallback',
        path: 'total',
        score: scoreResolvedFileCandidate(entries, { pathKeys: ['total'] }),
      });
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.entries.length !== left.entries.length) {
        return right.entries.length - left.entries.length;
      }
      return String(left.path || '').length - String(right.path || '').length;
    });

    return candidates[0] || null;
  }

  function extractResolvedFileEntries(payload) {
    return pickBestResolvedFileCandidate(payload)?.entries || [];
  }

  function extractResolvedFileCount(payload, fallback = 0) {
    const explicit = toFiniteNumberOrNull(
      findFirstValueByKeys(payload, ['fileCount', 'file_count', 'totalCount', 'total_count', 'count', 'total'])
    );
    if (explicit != null && explicit > 0) {
      return explicit;
    }
    return Math.max(0, Number(fallback || 0));
  }

  function getResolvedEntryExt(entry) {
    return String(getExt(entry?.name || '') || '').replace(/^\./, '').toLowerCase();
  }

  function isLikelyJunkResolvedEntry(entry) {
    const ext = getResolvedEntryExt(entry);
    const name = String(entry?.name || '');
    if (ext && CLOUD_JUNK_EXTENSIONS.has(ext)) {
      return true;
    }
    return CLOUD_SKIP_NAME_PATTERNS.some((pattern) => pattern.test(name));
  }

  function isLikelyVideoResolvedEntry(entry) {
    const ext = getResolvedEntryExt(entry);
    return Boolean(ext && CLOUD_VIDEO_EXTENSIONS.has(ext));
  }

  function selectResolvedEntriesForImport(entries) {
    const source = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!source.length) {
      return [];
    }

    const videoEntries = source.filter((entry) => isLikelyVideoResolvedEntry(entry));
    if (videoEntries.length) {
      const nonSampleVideoEntries = videoEntries.filter((entry) => !isLikelyJunkResolvedEntry(entry));
      return nonSampleVideoEntries.length ? nonSampleVideoEntries : videoEntries;
    }

    const nonJunkEntries = source.filter((entry) => !isLikelyJunkResolvedEntry(entry));
    if (nonJunkEntries.length) {
      return nonJunkEntries;
    }

    return source;
  }

  function extractResolvedResourceName(payload, magnetUrl, fallback = '') {
    return sanitizeCloudDirName(
      chooseBestNameCandidate([
        getMagnetDisplayName(magnetUrl),
        findFirstValueByKeys(payload, ['resourceName', 'resName', 'taskName', 'title', 'name', 'displayName']),
        fallback,
      ]) || '磁力资源',
      '磁力资源'
    );
  }

  function looksLikeNameExistError(detail) {
    const text = getErrorText(detail).toLowerCase();
    return ['exist', 'exists', 'already', '重复', '已存在', '同名'].some((keyword) => text.includes(keyword));
  }

  async function createDirectory(dirName, parentId = '', options = {}) {
    const response = await postJson(
      getCreateDirUrl(),
      {
        dirName,
        parentId: String(parentId || ''),
        failIfNameExist: options.failIfNameExist !== false,
      },
      getRequestHeaders()
    );

    if (!response.ok || !isProbablySuccess(response.payload, response)) {
      throw new Error(getErrorText(response.payload || response.text || `HTTP ${response.status}`));
    }

    const dirId = extractCreatedDirId(response.payload);
    if (!dirId) {
      throw new Error(`创建目录成功但未返回目录 ID：${dirName}`);
    }

    return {
      dirId,
      dirName,
      response,
    };
  }

  async function createDirectoryWithFallback(baseName, parentId = '', options = {}) {
    const normalized = sanitizeCloudDirName(baseName, options.fallbackName || '磁力资源');
    const token = buildTimestampToken();
    const candidates = [
      normalized,
      `${normalized}-${token}`,
      `${normalized}-${token}-${Math.random().toString(36).slice(2, 6)}`,
    ].filter((value, index, list) => list.indexOf(value) === index);

    let lastError = null;
    for (const name of candidates) {
      try {
        return await createDirectory(name, parentId, {
          failIfNameExist: true,
        });
      } catch (err) {
        lastError = err;
        if (!looksLikeNameExistError(err) && name === normalized) {
          throw err;
        }
      }
    }

    throw lastError || new Error(`创建目录失败：${normalized}`);
  }

  async function resolveCloudResource(url) {
    return postJson(getResolveResUrl(), { url: String(url || '').trim() }, getRequestHeaders());
  }

  async function createCloudTask(fileIndexes, url, parentId) {
    return postJson(
      getCloudCreateTaskUrl(),
      {
        fileIndexes,
        url: String(url || '').trim(),
        parentId: String(parentId || ''),
      },
      getRequestHeaders()
    );
  }

  function normalizeCloudTaskRow(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return null;
    }
    const taskId = findFirstValueByKeys(obj, ['taskId', 'task_id', 'id']);
    const status = findFirstValueByKeys(obj, ['taskStatus', 'task_status', 'status', 'state']);
    const url = findFirstValueByKeys(obj, ['url', 'sourceUrl', 'source_url']);
    const name = chooseBestNameCandidate([
      obj.name,
      obj.taskName,
      obj.resourceName,
      obj.resName,
      obj.displayName,
      getMagnetDisplayName(url || ''),
    ]);

    if (taskId == null || (!status && !url && !name)) {
      return null;
    }

    return {
      taskId: String(taskId),
      status: status == null ? '' : String(status),
      url: url == null ? '' : String(url),
      name,
      raw: obj,
    };
  }

  function scanCloudTaskRows(node, out = []) {
    if (!node || typeof node !== 'object') {
      return out;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        scanCloudTaskRows(item, out);
      }
      return out;
    }

    const normalized = normalizeCloudTaskRow(node);
    if (normalized) {
      out.push(normalized);
    }

    for (const value of Object.values(node)) {
      scanCloudTaskRows(value, out);
    }
    return out;
  }

  function extractCloudTaskRows(payload) {
    const rows = scanCloudTaskRows(payload);
    const seen = new Set();
    return rows.filter((row) => {
      if (!row.taskId || seen.has(row.taskId)) {
        return false;
      }
      seen.add(row.taskId);
      return true;
    });
  }

  async function listCloudTasks(options = {}) {
    const statuses = Array.isArray(options.statuses) && options.statuses.length ? options.statuses : [0, 1, 2, 3, 4];
    const pageSize = Math.max(1, Number(options.pageSize || CONFIG.cloud.listTaskPageSize || 50));
    const response = await postJson(
      getCloudListTaskUrl(),
      {
        pageSize,
        status: statuses,
      },
      getRequestHeaders()
    );
    STATE.lastCloudTaskList = response.payload || response.text || null;
    return response;
  }

  function extractMagnetLinks(text) {
    const matches = String(text || '').match(/magnet:\?[^\s"'<>]+/ig) || [];
    const seen = new Set();
    const out = [];
    for (const match of matches) {
      const magnet = String(match || '').trim().replace(/[),.;]+$/g, '');
      if (!magnet || seen.has(magnet)) {
        continue;
      }
      seen.add(magnet);
      out.push(magnet);
    }
    return out;
  }

  function extractMagnetLinksFromJsonNode(node, out = [], seen = new Set()) {
    if (node == null) {
      return out;
    }

    if (typeof node === 'string') {
      for (const magnet of extractMagnetLinks(node)) {
        if (!seen.has(magnet)) {
          seen.add(magnet);
          out.push(magnet);
        }
      }
      return out;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        extractMagnetLinksFromJsonNode(item, out, seen);
      }
      return out;
    }

    if (typeof node === 'object') {
      for (const value of Object.values(node)) {
        extractMagnetLinksFromJsonNode(value, out, seen);
      }
    }

    return out;
  }

  function extractMagnetLinksFromAnyContent(text, fileName = '') {
    const raw = String(text || '');
    const ext = String(fileName || '').toLowerCase();
    const magnetsFromText = extractMagnetLinks(raw);

    if (!/\.json$/i.test(ext)) {
      return magnetsFromText;
    }

    const json = safeJsonParse(raw);
    if (json == null) {
      return magnetsFromText;
    }

    const magnetsFromJson = extractMagnetLinksFromJsonNode(json);
    return magnetsFromJson.length ? magnetsFromJson : magnetsFromText;
  }

  async function readMagnetImportFiles(fileList, options = {}) {
    const files = Array.from(fileList || []).filter(Boolean);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const parsed = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const text = await file.text();
      const magnets = extractMagnetLinksFromAnyContent(text, file.name);
      parsed.push({
        key: [file.name, file.size, file.lastModified].join(':'),
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        magnets,
        magnetCount: magnets.length,
        sampleMagnet: magnets[0] || '',
      });

      if (onProgress) {
        onProgress({
          visible: true,
          percent: Math.round(((index + 1) / Math.max(1, files.length)) * 100),
          indeterminate: false,
          text: `正在识别本地磁力文件 ${index + 1}/${files.length}：${file.name} | 磁力 ${magnets.length} 条`,
        });
      }
    }

    return parsed;
  }

  function setMagnetImportFiles(entries, options = {}) {
    const append = Boolean(options.append);
    const next = append ? [...(STATE.magnetImportFiles || [])] : [];
    const indexByKey = new Map(next.map((item, index) => [item.key, index]));

    for (const entry of entries || []) {
      if (!entry || !entry.key) {
        continue;
      }
      if (indexByKey.has(entry.key)) {
        next[indexByKey.get(entry.key)] = entry;
      } else {
        indexByKey.set(entry.key, next.length);
        next.push(entry);
      }
    }

    STATE.magnetImportFiles = next;
    renderMagnetImportList();
    if (UI.magnetDetails && next.length) {
      UI.magnetDetails.open = true;
    }
  }

  function getSelectedMagnetImportStats() {
    const files = Array.isArray(STATE.magnetImportFiles) ? STATE.magnetImportFiles : [];
    const magnets = files.reduce((sum, item) => sum + Number(item.magnetCount || item.magnets?.length || 0), 0);
    return {
      fileCount: files.length,
      magnetCount: magnets,
    };
  }

  function renderMagnetImportList() {
    if (!UI.magnetFileList || !UI.magnetFileCount) {
      return;
    }

    const files = Array.isArray(STATE.magnetImportFiles) ? STATE.magnetImportFiles : [];
    const stats = getSelectedMagnetImportStats();
    UI.magnetFileCount.textContent = `磁力文本 ${stats.fileCount} 个 / 磁力 ${stats.magnetCount} 条`;

    if (!files.length) {
      UI.magnetFileList.innerHTML = '<div class="gyp-import-empty">选择包含 magnet 链接的 txt 或 json 文件后，脚本会自动识别并按每批 500 文件拆分云添加。</div>';
      return;
    }

    UI.magnetFileList.innerHTML = files.map((item) => `
      <div class="gyp-import-row">
        <div class="gyp-import-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="gyp-import-meta">磁力 ${Number(item.magnetCount || 0)} 条${item.sampleMagnet ? ` | 示例：${escapeHtml(shortDisplayName(getMagnetDisplayName(item.sampleMagnet), 32))}` : ''}</div>
      </div>
    `).join('');
  }

  function renderEmptyDirScanList() {
    if (!UI.emptyDirList || !UI.emptyDirCount) {
      return;
    }

    const scan = STATE.lastEmptyDirScan || null;
    const items = Array.isArray(scan?.emptyDirs) ? scan.emptyDirs : [];
    const selected = items.filter((item) => STATE.emptyDirSelection[String(item.fileId || '')] !== false);
    UI.emptyDirCount.textContent = scan
      ? `删除勾选 ${selected.length}/${items.length} | 已扫目录 ${Number(scan.scannedDirs || 0)} 个${scan.truncated ? ' / 可能未扫全' : ''}`
      : '空目录 0 个';

    if (!scan) {
      UI.emptyDirList.innerHTML = '<div class="gyp-import-empty">点“扫描空目录”后，这里会列出当前目录树里最里层且完全空的目录。</div>';
      return;
    }

    if (!items.length) {
      UI.emptyDirList.innerHTML = `
        <div class="gyp-import-empty">
          ${scan.truncated
            ? `本次已扫描 ${Number(scan.scannedDirs || 0)} 个目录，暂未发现空目录；因为分页或目录数量较多，结果可能还不完整。`
            : `本次已扫描 ${Number(scan.scannedDirs || 0)} 个目录，当前目录树下没有发现最里层空目录。`}
        </div>
      `;
      return;
    }

    UI.emptyDirList.innerHTML = items.map((item) => {
      const metaParts = [];
      if (Number(item.depth || 0) > 0) {
        metaParts.push(`层级 ${Number(item.depth)}`);
      }
      metaParts.push(item.confidence === 'likely' ? '低置信度，建议确认后再删' : '高置信度');
      metaParts.push(`目录 ID: ${escapeHtml(String(item.fileId || ''))}`);
      return `
      <label class="gyp-empty-dir-row" data-confidence="${item.confidence === 'likely' ? 'likely' : 'confirmed'}">
        <input
          type="checkbox"
          data-action="toggle-empty-dir"
          data-file-id="${escapeHtml(String(item.fileId || ''))}"
          ${STATE.emptyDirSelection[String(item.fileId || '')] !== false ? 'checked' : ''}
        />
        <span class="gyp-empty-dir-main">
          <span class="gyp-empty-dir-path" title="${escapeHtml(item.path || item.name || '(当前目录)')}">${escapeHtml(item.path || item.name || '(当前目录)')}</span>
          <span class="gyp-empty-dir-meta">${metaParts.join(' | ')}</span>
        </span>
      </label>
    `;
    }).join('');
  }

  function setEmptyDirScanResult(summary, options = {}) {
    if (!summary || !Array.isArray(summary.emptyDirs)) {
      STATE.lastEmptyDirScan = summary || null;
      STATE.emptyDirSelection = {};
      renderEmptyDirScanList();
      return;
    }

    const preserveSelection = Boolean(options.preserveSelection);
    const nextSelection = {};
    const emptyDirs = summary.emptyDirs
      .filter((item) => item && item.fileId)
      .map((item) => ({
        ...item,
        fileId: String(item.fileId),
        dirId: String(item.dirId || item.fileId),
        dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
        confidence: item.confidence === 'likely' ? 'likely' : 'confirmed',
      }));

    for (const item of emptyDirs) {
      if (preserveSelection && Object.prototype.hasOwnProperty.call(STATE.emptyDirSelection, item.fileId)) {
        nextSelection[item.fileId] = STATE.emptyDirSelection[item.fileId] !== false;
      } else {
        nextSelection[item.fileId] = item.confidence !== 'likely';
      }
    }

    STATE.lastEmptyDirScan = {
      ...summary,
      emptyDirs,
    };
    STATE.emptyDirSelection = nextSelection;
    renderEmptyDirScanList();
  }

  function getSelectedEmptyDirItems() {
    const items = Array.isArray(STATE.lastEmptyDirScan?.emptyDirs) ? STATE.lastEmptyDirScan.emptyDirs : [];
    return items.filter((item) => STATE.emptyDirSelection[String(item.fileId || '')] !== false);
  }

  function removeEmptyDirScanItemsByIds(fileIds) {
    const deletedIds = new Set((fileIds || []).map((id) => String(id)).filter(Boolean));
    if (!deletedIds.size || !STATE.lastEmptyDirScan) {
      return;
    }

    removeCapturedItemsByIds(Array.from(deletedIds));
    setEmptyDirScanResult({
      ...STATE.lastEmptyDirScan,
      emptyDirs: (STATE.lastEmptyDirScan.emptyDirs || []).filter((item) => !deletedIds.has(String(item.fileId || ''))),
    }, {
      preserveSelection: true,
    });
  }

  async function fetchDirectoryItemsByParentId(parentId, options = {}) {
    const normalizedParentId = String(parentId || '').trim();
    if (!normalizedParentId) {
      return {
        items: [],
        pageCount: 0,
        truncated: false,
      };
    }

    const pageSize = Math.max(1, Number(options.pageSize || UI.fields.pageSize?.value || CONFIG.request.manualListBody.pageSize || 100));
    const maxPages = Math.max(1, Number(options.maxPages || EMPTY_DIR_SCAN_MAX_PAGES_PER_DIR));
    const delayMs = Math.max(0, Number(options.delayMs != null ? options.delayMs : CONFIG.batch.delayMs || 0));
    const taskControl = options.taskControl || null;
    const seenIds = new Set();
    const allItems = [];
    let truncated = false;
    let pageCount = 0;
    let hitPageLimit = true;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      await waitForTaskControl(taskControl);
      const requestBody = {
        parentId: normalizedParentId,
        pageSize,
      };
      if (pageIndex > 0) {
        requestBody.page = pageIndex + 1;
      }

      const { items } = await requestListBatch(requestBody);
      pageCount = pageIndex + 1;

      const batchItems = dedupeItems(items);
      if (!batchItems.length) {
        hitPageLimit = false;
        break;
      }

      let newCount = 0;
      for (const item of batchItems) {
        const key = String(item?.fileId || '');
        if (!key || seenIds.has(key)) {
          continue;
        }
        seenIds.add(key);
        allItems.push(item);
        newCount += 1;
      }

      if (batchItems.length < pageSize) {
        hitPageLimit = false;
        break;
      }

      if (!newCount) {
        truncated = true;
        break;
      }

      if (delayMs > 0) {
        await controlledDelay(delayMs, taskControl);
      }
    }

    if (hitPageLimit && pageCount >= maxPages) {
      truncated = true;
    }

    return {
      items: allItems,
      pageCount,
      truncated,
    };
  }

  async function fetchDirectoryItems(parentId, options = {}) {
    const candidates = normalizeIdCandidates([
      ...(Array.isArray(options.idCandidates) ? options.idCandidates : []),
      parentId,
    ]);
    const forwardedOptions = { ...options };
    delete forwardedOptions.idCandidates;

    let lastError = null;
    let hadError = false;
    let bestResult = {
      items: [],
      pageCount: 0,
      truncated: false,
      usedParentId: '',
      uncertain: false,
    };

    for (const candidate of candidates) {
      try {
        const result = await fetchDirectoryItemsByParentId(candidate, forwardedOptions);
        if (result.items.length) {
          return {
            ...result,
            usedParentId: candidate,
          };
        }
        if (!bestResult.items.length) {
          bestResult = {
            ...result,
            usedParentId: candidate,
            uncertain: false,
          };
        }
      } catch (err) {
        hadError = true;
        lastError = err;
      }
    }

    if (lastError && !bestResult.usedParentId) {
      throw lastError;
    }

    return {
      ...bestResult,
      uncertain: hadError && !bestResult.items.length,
    };
  }


  function getEmptyScanItemTypeHints(item) {
    const raw = item && item.raw && typeof item.raw === 'object' ? item.raw : {};
    const values = [
      raw.itemType,
      raw.item_type,
      raw.nodeType,
      raw.node_type,
      raw.resourceType,
      raw.resource_type,
      raw.resType,
      raw.res_type,
      raw.fileType,
      raw.file_type,
      raw.type,
      raw.kind,
      raw.bizType,
      raw.biz_type,
    ];

    return values
      .map((value) => String(value == null ? '' : value).trim().toLowerCase())
      .filter((value) => value !== '');
  }

  function getEmptyScanNameExtension(name = '') {
    const normalized = String(getExt(name) || '').replace(/^\./, '').toLowerCase();
    if (normalized) {
      return normalized;
    }

    const fallback = String(name || '').trim().match(/\.([a-z0-9]{1,8})$/i);
    return fallback ? String(fallback[1] || '').toLowerCase() : '';
  }

  function hasPositiveSizeLikeField(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const keys = [
      'size',
      'fileSize',
      'file_size',
      'contentLength',
      'content_length',
      'byteSize',
      'byte_size',
      'bytes',
    ];

    return keys.some((key) => {
      const value = source[key];
      if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0;
      }
      if (typeof value === 'string') {
        const text = value.trim();
        if (!text) {
          return false;
        }
        if (/^\d+$/u.test(text)) {
          return Number(text) > 0;
        }
        return /^\d+(?:\.\d+)?\s*(?:b|kb|mb|gb|tb)$/iu.test(text);
      }
      return false;
    });
  }

  function hasMeaningfulDirectoryValue(value) {
    if (value == null) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim() !== '';
    }
    return true;
  }

  function hasDirectoryCountHint(value) {
    const numeric = toFiniteNumberOrNull(value);
    if (numeric != null) {
      return numeric >= 0;
    }
    return hasMeaningfulDirectoryValue(value);
  }

  function isStrongFileLikeItem(item) {
    if (!item) {
      return false;
    }

    const raw = item && item.raw && typeof item.raw === 'object' ? item.raw : {};
    const explicitFlags = [
      raw.isDir,
      raw.is_dir,
      raw.isFolder,
      raw.is_folder,
      raw.folder,
      raw.directory,
      raw.dir,
    ].map((value) => normalizeBooleanish(value)).find((value) => value != null);
    if (explicitFlags === true) {
      return false;
    }
    if (explicitFlags === false) {
      return true;
    }

    const ext = getEmptyScanNameExtension(item.name || '');
    if (ext && (
      KNOWN_FILE_EXTENSIONS.has(ext)
      || CLOUD_VIDEO_EXTENSIONS.has(ext)
      || CLOUD_JUNK_EXTENSIONS.has(ext)
      || EMPTY_SCAN_EXTRA_FILE_EXTENSIONS.has(ext)
    )) {
      return true;
    }

    const typeHints = getEmptyScanItemTypeHints(item);
    if (typeHints.some((value) => /(dir|folder|directory|catalog)/i.test(value))) {
      return false;
    }
    if (typeHints.some((value) => /(file|video|image|audio|doc|text|subtitle|torrent)/i.test(value))) {
      return true;
    }
    // 光鸭返回的 type / fileType 有时目录和文件都会是数字，不能只凭数字就判死为文件。

    if (hasPositiveSizeLikeField(raw)) {
      return true;
    }

    return false;
  }

  function getEmptyScanVisibleDirNameSet(rows = []) {
    return new Set(
      (rows || [])
        .filter((item) => item && item.isDir)
        .map((item) => normalizeDomName(item.name))
        .filter(Boolean)
    );
  }

  function getEmptyScanDirectoryHintLevel(item, visibleDirNameSet = null) {
    if (!item) {
      return 0;
    }

    const id = String(item.fileId || item.dirId || '').trim();
    if (!id || isSyntheticDomId(id)) {
      return 0;
    }

    const raw = item && item.raw && typeof item.raw === 'object' ? item.raw : {};
    const explicitFlags = [
      raw.isDir,
      raw.is_dir,
      raw.isFolder,
      raw.is_folder,
      raw.folder,
      raw.directory,
      raw.dir,
    ].map((value) => normalizeBooleanish(value)).find((value) => value != null);
    if (explicitFlags === true) {
      return 2;
    }
    if (explicitFlags === false) {
      return -1;
    }

    if (isStrongFileLikeItem(item)) {
      return -1;
    }

    if (item.isDir === true || raw.domIsDir) {
      return 2;
    }

    const nameKey = normalizeDomName(item.name || '');
    if (visibleDirNameSet instanceof Set && nameKey && visibleDirNameSet.has(nameKey)) {
      return 2;
    }

    if (shouldTreatItemAsDirectory(item)) {
      return 2;
    }

    const hasDirStructure = Boolean(
      hasMeaningfulDirectoryValue(raw.dirName)
      || hasMeaningfulDirectoryValue(raw.dir_name)
      || hasMeaningfulDirectoryValue(raw.folderName)
      || hasMeaningfulDirectoryValue(raw.folder_name)
      || hasMeaningfulDirectoryValue(raw.folderId)
      || hasMeaningfulDirectoryValue(raw.folder_id)
      || hasDirectoryCountHint(raw.childCount)
      || hasDirectoryCountHint(raw.childrenCount)
      || hasDirectoryCountHint(raw.children_count)
      || hasDirectoryCountHint(raw.dirCount)
      || hasDirectoryCountHint(raw.dir_count)
      || hasDirectoryCountHint(raw.folderCount)
      || hasDirectoryCountHint(raw.folder_count)
      || hasDirectoryCountHint(raw.subCount)
      || hasDirectoryCountHint(raw.sub_count)
      || hasMeaningfulDirectoryValue(raw.dirId)
      || hasMeaningfulDirectoryValue(raw.dir_id)
    );
    if (hasDirStructure) {
      return 2;
    }

    const hasTypeHints = getEmptyScanItemTypeHints(item).length > 0;
    const hasFileExtension = Boolean(getEmptyScanNameExtension(item.name || ''));
    if (!hasTypeHints && !hasFileExtension && !hasPositiveSizeLikeField(raw)) {
      return 1;
    }

    return 0;
  }

  async function fetchDirectoryListingForEmptyScan(parentId, options = {}) {
    const result = await fetchDirectoryItems(parentId, options);
    let items = Array.isArray(result.items) ? result.items : [];

    if (options.includeCurrentSnapshot) {
      const snapshotItems = buildCurrentDirectoryItemsSnapshot(parentId);
      items = dedupeItems([...(Array.isArray(items) ? items : []), ...snapshotItems]);
    }

    return {
      ...result,
      items,
    };
  }


  async function scanEmptyLeafDirectories(options = {}) {
    const rootSnapshot = getDirectoryContextSnapshot();
    const rootParentId = String(options.parentId || rootSnapshot.parentId || CONFIG.request.manualListBody.parentId || '').trim();
    if (!rootParentId) {
      throw new Error('没有拿到 parentId。请先打开要扫描的目录，或在高级兜底里手填 parentId。');
    }

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const maxDirs = Math.max(1, Number(options.maxDirs || EMPTY_DIR_SCAN_MAX_DIRS));
    const rootName = String(options.rootName || rootSnapshot.name || '(当前目录)').trim() || '(当前目录)';
    const rootNode = {
      fileId: rootParentId,
      dirId: rootParentId,
      dirIdCandidates: [rootParentId],
      name: rootName,
      path: rootName,
      depth: 0,
      isRoot: true,
      confidence: 'confirmed',
    };
    const visited = new Set([rootParentId]);
    const emptyDirs = [];
    const rootVisibleDirNameSet = getEmptyScanVisibleDirNameSet(collectVisibleDirectoryRows());
    let scannedDirs = 0;
    let scannedItems = 0;
    let truncated = false;
    let aborted = false;

    async function walkDirectory(current, prefetchedListing = null) {
      if (!current || aborted) {
        return;
      }
      await waitForTaskControl(taskControl);

      if (visited.size > maxDirs) {
        truncated = true;
        aborted = true;
        return;
      }

      if (onProgress) {
        onProgress({
          visible: true,
          percent: Math.min(95, Math.max(1, scannedDirs)),
          indeterminate: true,
          text: `正在扫描空目录：${shortDisplayName(current.path, 42)} | 已扫 ${scannedDirs} 个目录`,
        });
      }
      if (CONFIG.debug) {
        log(`空目录扫描检查目录：${current.path} | dirId=${current.dirId || ''} | fileId=${current.fileId || ''}`);
      }

      let inspection = prefetchedListing;
      try {
        if (!inspection) {
          inspection = await fetchDirectoryListingForEmptyScan(current.dirId || current.fileId, {
            pageSize: options.pageSize,
            maxPages: options.maxPages,
            delayMs: options.delayMs,
            idCandidates: current.dirIdCandidates,
            includeCurrentSnapshot: Boolean(current.isRoot),
            taskControl,
          });
        }
      } catch (err) {
        truncated = true;
        warn('空目录扫描拉取目录失败，已跳过：', {
          path: current.path,
          dirId: current.dirId,
          error: getErrorText(err),
        });
        return;
      }

      scannedDirs += 1;
      scannedItems += inspection.items.length;
      if (inspection.truncated || inspection.uncertain) {
        truncated = true;
      }

      if (!inspection.items.length) {
        emptyDirs.push({
          fileId: String(current.fileId || current.dirId || '').trim(),
          dirId: String(current.dirId || current.fileId || '').trim(),
          dirIdCandidates: normalizeIdCandidates([
            current.dirId,
            current.fileId,
            ...(current.dirIdCandidates || []),
          ]),
          name: current.name || '(当前目录)',
          path: current.path || '(当前目录)',
          depth: current.depth || 0,
          confidence: current.confidence === 'likely' ? 'likely' : 'confirmed',
        });
        return;
      }

      const visibleDirNameSet = current.isRoot ? rootVisibleDirNameSet : null;
      const childItems = Array.isArray(inspection.items) ? inspection.items.filter(Boolean) : [];
      for (const child of childItems) {
        await waitForTaskControl(taskControl);
        if (aborted) {
          break;
        }

        const childFileId = String(child.fileId || '').trim();
        if (!childFileId || isSyntheticDomId(childFileId) || !String(child.name || '').trim()) {
          continue;
        }

        const hintLevel = getEmptyScanDirectoryHintLevel(child, visibleDirNameSet);
        if (hintLevel < 0) {
          continue;
        }

        if (visited.size >= maxDirs) {
          truncated = true;
          aborted = true;
          break;
        }

        let childInspection = null;
        try {
          childInspection = await fetchDirectoryListingForEmptyScan(childFileId, {
            pageSize: options.pageSize,
            maxPages: options.maxPages,
            delayMs: options.delayMs,
            idCandidates: normalizeIdCandidates([
              childFileId,
              child.dirId,
              ...(child.dirIdCandidates || []),
            ]),
            taskControl,
          });
        } catch (err) {
          truncated = true;
          warn('空目录扫描探测子项失败，已跳过：', {
            path: current.path,
            childName: child.name,
            childFileId,
            error: getErrorText(err),
          });
          continue;
        }

        if (childInspection.truncated || childInspection.uncertain) {
          truncated = true;
        }

        const actualChildParentId = String(childInspection.usedParentId || child.dirId || childFileId).trim();
        if (childInspection.items.length) {
          if (!actualChildParentId || visited.has(actualChildParentId)) {
            continue;
          }
          visited.add(actualChildParentId);

          await walkDirectory({
            fileId: childFileId,
            dirId: actualChildParentId,
            dirIdCandidates: normalizeIdCandidates([
              actualChildParentId,
              child.dirId,
              childFileId,
              ...(child.dirIdCandidates || []),
            ]),
            name: String(child.name || actualChildParentId),
            path: current.isRoot ? String(child.name || actualChildParentId) : `${current.path}/${String(child.name || actualChildParentId)}`,
            depth: Number(current.depth || 0) + 1,
            isRoot: false,
            confidence: hintLevel >= 2 ? 'confirmed' : 'likely',
          }, childInspection);
          continue;
        }

        if (hintLevel <= 0) {
          continue;
        }

        emptyDirs.push({
          fileId: childFileId,
          dirId: actualChildParentId || childFileId,
          dirIdCandidates: normalizeIdCandidates([
            actualChildParentId,
            child.dirId,
            childFileId,
            ...(child.dirIdCandidates || []),
          ]),
          name: String(child.name || childFileId),
          path: current.isRoot ? String(child.name || childFileId) : `${current.path}/${String(child.name || childFileId)}`,
          depth: Number(current.depth || 0) + 1,
          confidence: hintLevel >= 2 ? 'confirmed' : 'likely',
        });
      }
    }

    await waitForTaskControl(taskControl);
    const rootInspection = await fetchDirectoryListingForEmptyScan(rootParentId, {
      pageSize: options.pageSize,
      maxPages: options.maxPages,
      delayMs: options.delayMs,
      idCandidates: [rootParentId],
      includeCurrentSnapshot: true,
      taskControl,
    });
    await walkDirectory(rootNode, rootInspection);

    const summary = {
      rootParentId,
      scannedDirs,
      scannedItems,
      emptyDirs,
      truncated,
      scannedAt: new Date().toISOString(),
    };
    setEmptyDirScanResult(summary);
    if (UI.emptyDirDetails) {
      UI.emptyDirDetails.open = true;
    }

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 100,
        indeterminate: false,
        text: truncated
          ? `空目录扫描完成：找到 ${emptyDirs.length} 个空目录，已扫 ${scannedDirs} 个目录，结果可能未扫全`
          : `空目录扫描完成：找到 ${emptyDirs.length} 个空目录，已扫 ${scannedDirs} 个目录`,
      });
    }

    console.table(emptyDirs.map((item) => ({
      path: item.path,
      dirId: item.fileId,
      depth: item.depth,
      confidence: item.confidence || 'confirmed',
    })));

    return summary;
  }


  function getCloudImportParentId() {
    const context = getCurrentListContext();
    return String(context.parentId || CONFIG.request.manualListBody.parentId || '').trim();
  }

  function buildSourceImportDirName(fileName, runToken) {
    const prefix = sanitizeCloudDirName(CONFIG.cloud.sourceDirPrefix || '磁力导入', '磁力导入');
    const base = sanitizeCloudDirName(stripGenericExtension(fileName), '磁力文本');
    return `${prefix}-${base}-${runToken}`;
  }

  function buildMagnetImportDirName(magnetUrl, payload, magnetIndex) {
    return extractResolvedResourceName(payload, magnetUrl, `磁力_${magnetIndex}`);
  }

  async function importMagnetTextFiles(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const sourceFiles = (STATE.magnetImportFiles || []).filter((item) => Array.isArray(item.magnets) && item.magnets.length);

    if (!sourceFiles.length) {
      throw new Error('还没有选择可导入的磁力 txt/json 文件。请先点“选择TXT/JSON”。');
    }

    const batchLimit = Math.max(1, Number(options.batchLimit || CONFIG.cloud.maxFilesPerTask || 500));
    const requestDelayMs = Math.max(0, Number(options.delayMs ?? CONFIG.batch.delayMs ?? 300));
    const parentId = String(options.parentId != null ? options.parentId : getCloudImportParentId());
    const runToken = buildTimestampToken();
    const totalMagnets = sourceFiles.reduce((sum, item) => sum + item.magnets.length, 0);
    const summary = {
      parentId,
      batchLimit,
      sourceFileCount: sourceFiles.length,
      totalMagnets,
      submittedMagnets: 0,
      skippedMagnets: 0,
      skippedExistingMagnets: 0,
      skippedDuplicateMagnets: 0,
      failedMagnets: 0,
      totalResolvedFiles: 0,
      totalTaskBatches: 0,
      submittedTaskBatches: 0,
      failedTaskBatches: 0,
      taskIds: [],
      skipped: [],
      failures: [],
      sourceDirs: [],
      existingTaskCount: 0,
      startedAt: new Date().toISOString(),
      finishedAt: '',
    };

    const existingTaskKeys = new Set();
    const inputSeenMagnetKeys = new Set();
    let processedMagnets = 0;

    try {
      await waitForTaskControl(taskControl);
      if (onProgress) {
        onProgress({
          visible: true,
          percent: 1,
          indeterminate: true,
          text: '正在读取云任务历史，用于识别已添加磁力...',
        });
      }

      const existingTasks = await listCloudTasks({
        pageSize: CONFIG.cloud.listTaskPageSize || 50,
      });
      if (existingTasks.ok && isProbablySuccess(existingTasks.payload, existingTasks)) {
        const rows = extractCloudTaskRows(existingTasks.payload);
        summary.existingTaskCount = rows.length;
        for (const row of rows) {
          const key = getMagnetIdentityKey(row.url);
          if (key) {
            existingTaskKeys.add(key);
          }
        }
      }
    } catch (err) {
      warn('读取云任务历史失败，将仅对本次导入内容做去重：', err);
    }

    for (const sourceFile of sourceFiles) {
      await waitForTaskControl(taskControl);
      const pendingMagnets = [];
      for (const magnetUrl of sourceFile.magnets) {
        await waitForTaskControl(taskControl);
        const magnetKey = getMagnetIdentityKey(magnetUrl);

        if (magnetKey && existingTaskKeys.has(magnetKey)) {
          summary.skippedMagnets += 1;
          summary.skippedExistingMagnets += 1;
          if (summary.skipped.length < 200) {
            summary.skipped.push({
              sourceFile: sourceFile.name,
              magnet: magnetUrl,
              reason: '历史云任务中已存在',
            });
          }
          processedMagnets += 1;
          continue;
        }

        if (magnetKey && inputSeenMagnetKeys.has(magnetKey)) {
          summary.skippedMagnets += 1;
          summary.skippedDuplicateMagnets += 1;
          if (summary.skipped.length < 200) {
            summary.skipped.push({
              sourceFile: sourceFile.name,
              magnet: magnetUrl,
              reason: '本次导入文件中重复',
            });
          }
          processedMagnets += 1;
          continue;
        }

        if (magnetKey) {
          inputSeenMagnetKeys.add(magnetKey);
        }
        pendingMagnets.push({
          magnetUrl,
          magnetKey,
        });
      }

      if (!pendingMagnets.length) {
        continue;
      }

      let sourceDir = null;
      try {
        await waitForTaskControl(taskControl);
        sourceDir = await createDirectoryWithFallback(buildSourceImportDirName(sourceFile.name, runToken), parentId, {
          fallbackName: '磁力导入',
        });
        summary.sourceDirs.push({
          name: sourceDir.dirName,
          dirId: sourceDir.dirId,
          sourceFile: sourceFile.name,
        });
      } catch (err) {
        summary.failedMagnets += pendingMagnets.length;
        for (const { magnetUrl } of pendingMagnets) {
          summary.failures.push({
            sourceFile: sourceFile.name,
            magnet: magnetUrl,
            message: `创建导入目录失败：${getErrorText(err)}`,
            submittedTaskBatches: 0,
          });
        }
        processedMagnets += pendingMagnets.length;
        warn('为磁力文本创建父目录失败，已跳过该文件：', {
          sourceFile: sourceFile.name,
          error: err,
        });
        continue;
      }

      for (let magnetIndex = 0; magnetIndex < pendingMagnets.length; magnetIndex += 1) {
        await waitForTaskControl(taskControl);
        const magnetUrl = pendingMagnets[magnetIndex].magnetUrl;
        const currentMagnetNo = processedMagnets + 1;
        let submittedForCurrentMagnet = 0;

        if (onProgress) {
          onProgress({
            visible: true,
            percent: Math.round(((currentMagnetNo - 1) / Math.max(1, totalMagnets)) * 100),
            indeterminate: true,
            text: `正在解析磁力 ${currentMagnetNo}/${totalMagnets}：${shortDisplayName(getMagnetDisplayName(magnetUrl), 42)}`,
          });
        }

        try {
          await waitForTaskControl(taskControl);
          const resolveRes = await resolveCloudResource(magnetUrl);
          if (!resolveRes.ok || !isProbablySuccess(resolveRes.payload, resolveRes)) {
            throw new Error(getErrorText(resolveRes.payload || resolveRes.text || `HTTP ${resolveRes.status}`));
          }

          const resolvedCandidate = pickBestResolvedFileCandidate(resolveRes.payload);
          const resolvedFiles = resolvedCandidate?.entries || [];
          const fileIndexes = Array.from(new Set(
            resolvedFiles
              .map((item) => toFiniteNumberOrNull(item?.index))
              .filter((value) => value != null)
          )).sort((a, b) => a - b);
          if (!fileIndexes.length) {
            throw new Error('resolve_res 没有返回可识别的文件列表，暂时无法自动拆分 fileIndexes');
          }

          log('磁力解析已选文件：', {
            magnet: getMagnetDisplayName(magnetUrl),
            candidateSource: resolvedCandidate?.source || 'unknown',
            candidatePath: resolvedCandidate?.path || '',
            candidateScore: Number(resolvedCandidate?.score || 0),
            fileCount: fileIndexes.length,
            sample: resolvedFiles.slice(0, 12).map((item) => ({
              index: item.index,
              name: item.name,
              sizeBytes: getResolvedEntrySizeBytes(item),
            })),
          });

          summary.totalResolvedFiles += fileIndexes.length;
          const batches = chunkArray(fileIndexes, batchLimit);
          summary.totalTaskBatches += batches.length;

          let taskParentId = sourceDir.dirId;
          if (CONFIG.cloud.createMagnetSubdir !== false) {
            await waitForTaskControl(taskControl);
            const magnetDir = await createDirectoryWithFallback(
              buildMagnetImportDirName(magnetUrl, resolveRes.payload, currentMagnetNo),
              sourceDir.dirId,
              { fallbackName: `磁力_${currentMagnetNo}` }
            );
            taskParentId = magnetDir.dirId;
          }

          for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
            await waitForTaskControl(taskControl);
            const indexes = batches[batchIndex];
            if (onProgress) {
              const basePercent = ((currentMagnetNo - 1) / Math.max(1, totalMagnets)) * 100;
              const innerPercent = ((batchIndex + 1) / Math.max(1, batches.length)) * (100 / Math.max(1, totalMagnets));
              onProgress({
                visible: true,
                percent: Math.min(99, Math.round(basePercent + innerPercent)),
                indeterminate: false,
                text: `正在提交云添加 ${currentMagnetNo}/${totalMagnets} | ${shortDisplayName(getMagnetDisplayName(magnetUrl), 36)} | 第 ${batchIndex + 1}/${batches.length} 批，文件 ${indexes.length} 个`,
              });
            }

            const taskRes = await createCloudTask(indexes, magnetUrl, taskParentId);
            if (!taskRes.ok || !isProbablySuccess(taskRes.payload, taskRes)) {
              summary.failedTaskBatches += 1;
              throw new Error(getErrorText(taskRes.payload || taskRes.text || `HTTP ${taskRes.status}`));
            }

            const taskId = extractTaskId(taskRes.payload);
            if (taskId) {
              summary.taskIds.push(taskId);
            }
            summary.submittedTaskBatches += 1;
            submittedForCurrentMagnet += 1;

            if (requestDelayMs > 0) {
              await controlledDelay(requestDelayMs, taskControl);
            }
          }

          summary.submittedMagnets += 1;
        } catch (err) {
          summary.failedMagnets += 1;
          summary.failures.push({
            sourceFile: sourceFile.name,
            magnet: magnetUrl,
            message: getErrorText(err),
            submittedTaskBatches: submittedForCurrentMagnet,
          });
          warn('磁力云添加失败：', {
            sourceFile: sourceFile.name,
            magnetUrl,
            error: err,
          });
        } finally {
          processedMagnets += 1;
          STATE.lastCloudImportSummary = { ...summary };
        }
      }
    }

    try {
      await waitForTaskControl(taskControl);
      const cloudTasks = await listCloudTasks({
        pageSize: CONFIG.cloud.listTaskPageSize || 50,
      });
      if (cloudTasks.ok) {
        summary.taskRows = extractCloudTaskRows(cloudTasks.payload);
      }
    } catch (err) {
      warn('读取云添加任务列表失败：', err);
    }

    summary.finishedAt = new Date().toISOString();
    STATE.lastCloudImportSummary = { ...summary };

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 100,
        indeterminate: false,
        text: `云添加提交完成：磁力成功 ${summary.submittedMagnets} 条，跳过 ${summary.skippedMagnets} 条，失败 ${summary.failedMagnets} 条；任务批次成功 ${summary.submittedTaskBatches} 个，失败 ${summary.failedTaskBatches} 个`,
      });
    }

    return summary;
  }

  function extractTaskId(payload) {
    const taskId = findFirstValueByKeys(payload, ['taskId', 'task_id', 'id']);
    return taskId == null ? '' : String(taskId);
  }

  function extractTaskStatus(payload) {
    const raw = findFirstValueByKeys(payload, [
      'taskStatus',
      'task_status',
      'status',
      'state',
      'taskState',
      'task_state',
    ]);
    return raw == null ? '' : String(raw).toUpperCase();
  }

  function getNumericTaskStatus(status) {
    const value = Number(status);
    return Number.isFinite(value) ? value : null;
  }

  function toFiniteNumberOrNull(value) {
    if (value == null || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function getTaskStatusLabel(status) {
    const code = getNumericTaskStatus(status);
    if (code === null) {
      return status || 'UNKNOWN';
    }
    if (code === 0) {
      return '0(等待中)';
    }
    if (code === 1) {
      return '1(执行中)';
    }
    if (code === 2) {
      return '2(已完成)';
    }
    if (code === 3) {
      return '3(失败)';
    }
    if (code === 4) {
      return '4(已取消)';
    }
    return `${code}(未知状态码)`;
  }

  function normalizeBooleanish(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      if (!text) {
        return null;
      }
      if (['1', 'true', 'yes', 'y', 'dir', 'folder', 'directory'].includes(text)) {
        return true;
      }
      if (['0', 'false', 'no', 'n', 'file'].includes(text)) {
        return false;
      }
    }
    return null;
  }

  function normalizeIdCandidates(values = []) {
    return Array.from(new Set(
      (values || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
  }

  function isLikelyDirectoryIdKey(key) {
    const text = String(key || '').trim();
    if (!text) {
      return false;
    }
    if (/parentid/i.test(text)) {
      return false;
    }
    if (/(user|owner|creator|modifier|account|tenant|project|trace|task|category)id$/i.test(text)) {
      return false;
    }
    return /(dir|folder|file|resource|res|biz|obj|share).*id$/i.test(text) || /(^|_|\b)id$/i.test(text);
  }

  function collectIdLikeValues(node, out = [], seen = new WeakSet(), depth = 0) {
    if (!node || typeof node !== 'object' || depth > 3) {
      return out;
    }
    if (seen.has(node)) {
      return out;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        collectIdLikeValues(item, out, seen, depth + 1);
      }
      return out;
    }

    for (const [key, value] of Object.entries(node)) {
      if (isLikelyDirectoryIdKey(key) && (typeof value === 'string' || typeof value === 'number')) {
        out.push(value);
      }
      if (value && typeof value === 'object') {
        collectIdLikeValues(value, out, seen, depth + 1);
      }
    }

    return out;
  }

  function extractTaskCounts(payload, expectedTotal = 0) {
    const successCount = toFiniteNumberOrNull(findFirstValueByKeys(payload, ['successCount', 'success_count', 'doneCount', 'done_count']));
    const failedCount = toFiniteNumberOrNull(findFirstValueByKeys(payload, ['failedCount', 'failCount', 'failed_count', 'fail_count']));
    const totalCount = toFiniteNumberOrNull(findFirstValueByKeys(payload, ['totalCount', 'total_count', 'count', 'total']));

    const hasSuccessCount = successCount != null;
    const hasFailedCount = failedCount != null;
    const hasTotalCount = totalCount != null && totalCount > 0;
    const success = hasSuccessCount ? successCount : 0;
    const failed = hasFailedCount ? failedCount : 0;
    const total = hasTotalCount ? totalCount : (Number(expectedTotal) > 0 ? Number(expectedTotal) : 0);

    return {
      success,
      failed,
      total,
      processed: success + failed,
      hasSuccessCount,
      hasFailedCount,
      hasTotalCount,
      hasExplicitCounts: hasSuccessCount || hasFailedCount || hasTotalCount,
    };
  }

  function hasUsefulTaskState(payload, expectedTotal = 0) {
    const status = extractTaskStatus(payload);
    const counts = extractTaskCounts(payload, expectedTotal);
    const rawProgress = Number(findFirstValueByKeys(payload, ['progress', 'percent', 'percentage']));
    return Boolean(status || counts.hasExplicitCounts || Number.isFinite(rawProgress));
  }

  function isTaskFinished(payload, options = {}) {
    const status = extractTaskStatus(payload);
    if (status) {
      const numericStatus = getNumericTaskStatus(status);
      if (numericStatus != null) {
        if ([2, 3, 4].includes(numericStatus)) {
          return true;
        }
        if ([0, 1].includes(numericStatus)) {
          return false;
        }
      }

      const doneWords = ['SUCCESS', 'SUCCEEDED', 'DONE', 'FINISH', 'FINISHED', 'COMPLETED', 'FAILED', 'ERROR', 'CANCEL', '成功', '完成', '失败'];
      if (doneWords.some((word) => status.includes(word))) {
        return true;
      }
      const runningWords = ['RUN', 'PROCESS', 'PENDING', 'QUEUE', 'WAIT', '进行', '处理中', '等待'];
      if (runningWords.some((word) => status.includes(word))) {
        return false;
      }
    }

    const finished = findFirstValueByKeys(payload, ['finished', 'done', 'completed', 'isFinished']);
    if (typeof finished === 'boolean') {
      return finished;
    }

    const progress = Number(findFirstValueByKeys(payload, ['progress', 'percent', 'percentage']));
    if (Number.isFinite(progress) && progress >= 100) {
      return true;
    }

    const counts = extractTaskCounts(payload, options.expectedTotal || 0);
    if (counts.total > 0 && counts.processed >= counts.total) {
      return true;
    }
    if (counts.failed === 0 && counts.success > 0 && Number(options.expectedTotal || 0) > 0 && counts.success >= Number(options.expectedTotal || 0)) {
      return true;
    }

    return false;
  }

  function isTaskSuccessful(payload, options = {}) {
    const status = extractTaskStatus(payload);
    if (status) {
      const numericStatus = getNumericTaskStatus(status);
      if (numericStatus != null) {
        if (numericStatus === 2) {
          return true;
        }
        if ([3, 4].includes(numericStatus)) {
          return false;
        }
      }
    }
    if (status && ['FAILED', 'ERROR', 'CANCEL', 'CANCELLED', '失败'].some((word) => status.includes(word))) {
      return false;
    }
    if (status && ['SUCCESS', 'SUCCEEDED', 'DONE', 'FINISH', 'FINISHED', 'COMPLETED', '成功', '完成'].some((word) => status.includes(word))) {
      return true;
    }

    const success = findFirstValueByKeys(payload, ['success', 'ok']);
    if (typeof success === 'boolean') {
      return success;
    }

    const counts = extractTaskCounts(payload, options.expectedTotal || 0);
    if (counts.total > 0 && counts.processed >= counts.total) {
      return counts.failed === 0;
    }
    if (counts.failed > 0) {
      return false;
    }

    return true;
  }

  async function deleteFiles(fileIds) {
    return postJson(getDeleteUrl(), { fileIds }, getRequestHeaders());
  }

  async function moveFiles(fileIds, parentId) {
    const normalizedFileIds = Array.from(new Set((fileIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    return postJson(getMoveUrl(), { fileIds: normalizedFileIds, parentId: String(parentId || '').trim() }, getRequestHeaders());
  }

  async function getTaskStatus(taskId) {
    return postJson(getTaskStatusUrl(), { taskId }, getRequestHeaders());
  }

  function buildRenamePayload(target) {
    const base =
      STATE.lastRenameRequest?.requestBody && typeof STATE.lastRenameRequest.requestBody === 'object'
        ? JSON.parse(JSON.stringify(STATE.lastRenameRequest.requestBody))
        : {};

    const idKey = pickExistingKey(base, ['fileId', 'id', 'resourceId', 'resId', 'bizId', 'objId'], 'fileId');
    const nameKey = pickExistingKey(base, ['newName', 'name', 'fileName', 'file_name', 'filename', 'title'], 'newName');
    const payload = {};
    const stableExtraKeys = [
      'parentId',
      'shareId',
      'shareFileId',
      'spaceId',
      'driveId',
      'folderId',
      'resourceType',
      'resType',
      'fileType',
      'bizType',
    ];

    for (const key of stableExtraKeys) {
      if (base[key] != null && base[key] !== '') {
        payload[key] = base[key];
      }
    }

    payload[idKey] = target.fileId;
    payload[nameKey] = target.newName;
    return payload;
  }

  function getErrorText(detail) {
    if (!detail) {
      return '';
    }
    if (typeof detail === 'string') {
      return detail;
    }
    if (detail instanceof Error) {
      return detail.message || String(detail);
    }
    if (typeof detail === 'object') {
      return detail.message || detail.error || detail.msg || detail.code || JSON.stringify(detail);
    }
    return String(detail);
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function shortDisplayName(name, max = 24) {
    const text = String(name || '').trim();
    if (text.length <= max) {
      return text;
    }
    return `${text.slice(0, max)}...`;
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function toHalfWidthDigits(text) {
    return String(text || '').replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 65248));
  }

  function normalizeDuplicateName(name) {
    return toHalfWidthDigits(String(name || ''))
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getConfiguredDuplicateNumbers() {
    const values = String(CONFIG.duplicate.numbers || DEFAULT_DUPLICATE_NUMBERS)
      .split(/[\s,，、]+/)
      .map((x) => toHalfWidthDigits(x).trim())
      .filter(Boolean);
    return new Set(values.length ? values : DEFAULT_DUPLICATE_NUMBERS.split(','));
  }

  function getDuplicateInfo(name) {
    const original = String(name || '');
    const normalized = normalizeDuplicateName(original);
    if (!normalized) {
      return null;
    }

    const configuredNumbers = getConfiguredDuplicateNumbers();
    const directMatch = normalized.match(/^(.*?)[(]([0-9]+)[)]\s*$/u);
    if (directMatch && configuredNumbers.has(directMatch[2])) {
      return {
        matched: true,
        number: directMatch[2],
        baseName: directMatch[1].trim(),
        normalized,
        mode: 'direct-tail',
      };
    }

    const withExtMatch = normalized.match(/^(.*?)[(]([0-9]+)[)](\.[a-z0-9]{1,12})$/iu);
    if (withExtMatch && configuredNumbers.has(withExtMatch[2])) {
      return {
        matched: true,
        number: withExtMatch[2],
        baseName: withExtMatch[1].trim(),
        normalized,
        extension: withExtMatch[3],
        mode: 'before-extension',
      };
    }

    return null;
  }

  function isDuplicateName(name) {
    return Boolean(getDuplicateInfo(name));
  }

  function scoreNameCandidate(name) {
    const text = normalizeDuplicateName(name);
    if (!isProbablyUsefulName(text) || isProbablyMetadataText(text)) {
      return -1;
    }

    let score = text.length;
    if (isDuplicateName(text)) score += 120;
    if (/[（(][0-9０-９]+[）)]/.test(text)) score += 40;
    if (/[.\u4e00-\u9fa5A-Za-z]/.test(text)) score += 20;
    if (/\.[a-z0-9]{1,12}$/i.test(text)) score += 12;
    return score;
  }

  function chooseBestNameCandidate(candidates) {
    const values = Array.from(new Set((candidates || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (!values.length) {
      return '';
    }

    values.sort((a, b) => scoreNameCandidate(b) - scoreNameCandidate(a) || b.length - a.length);
    return values[0] || '';
  }

  function buildDuplicatePatternFromNumbers(numbersText) {
    const values = String(numbersText || DEFAULT_DUPLICATE_NUMBERS)
      .split(/[\s,，、]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => escapeRegExp(toHalfWidthDigits(x)));

    const group = values.length ? values.join('|') : '1|2|3';
    return `[（(]\\s*(?:${group})\\s*[）)]\\s*(?:\\.[a-zA-Z0-9]{1,12})?$`;
  }

  function getCurrentRuleMode(firstRule = CONFIG.rename.rules[0] || {}) {
    if (CONFIG.rename.ruleMode) {
      return CONFIG.rename.ruleMode;
    }
    if (firstRule.enabled === false) {
      return 'none';
    }
    if ((firstRule.type || '') === 'text') {
      return 'replace-text';
    }
    if ((firstRule.pattern || '') === DEFAULT_LEADING_BRACKET_PATTERN && (firstRule.flags || '') === 'u') {
      return 'remove-leading-bracket';
    }
    return 'custom-regex';
  }

  function getRuleModeLabel(mode = getCurrentRuleMode()) {
    if (mode === 'remove-leading-bracket') {
      return '删除开头第一个 [] / 【】 段';
    }
    if (mode === 'replace-text') {
      return '按固定文字查找并替换';
    }
    if (mode === 'none') {
      return '不处理前缀';
    }
    if (mode === 'custom-regex') {
      return '自定义正则（高级）';
    }
    return mode || '(未设置)';
  }

  function getRenameOutputModeLabel(mode = (CONFIG.rename.output || {}).mode || 'keep-clean') {
    if (mode === 'keep-clean') {
      return '直接使用处理后的名字';
    }
    if (mode === 'add-text') {
      return '增加文字';
    }
    if (mode === 'replace-text') {
      return '替换文字';
    }
    if (mode === 'format') {
      return '格式命名';
    }
    if (mode === 'custom-template') {
      return '自定义模板（高级）';
    }
    return mode || '(未设置)';
  }

  function splitRecognizedExtension(name) {
    const str = String(name || '');
    if (!str) {
      return {
        base: '',
        ext: '',
      };
    }

    const lower = str.toLowerCase();
    for (const ext of KNOWN_COMPOUND_FILE_EXTENSIONS) {
      if (lower.endsWith(ext) && str.length > ext.length) {
        return {
          base: str.slice(0, -ext.length),
          ext: str.slice(-ext.length),
        };
      }
    }

    const idx = str.lastIndexOf('.');
    if (idx <= 0) {
      return {
        base: str,
        ext: '',
      };
    }

    const extBody = lower.slice(idx + 1);
    if (!KNOWN_FILE_EXTENSIONS.has(extBody)) {
      return {
        base: str,
        ext: '',
      };
    }

    return {
      base: str.slice(0, idx),
      ext: str.slice(idx),
    };
  }

  function getBaseName(name) {
    return splitRecognizedExtension(name).base;
  }

  function getExt(name) {
    return splitRecognizedExtension(name).ext;
  }

  function renderTemplate(template, values) {
    return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key] == null ? '' : String(values[key]);
      }
      return '';
    });
  }

  function applyRulesWithRuleSet(name, rules, options = {}) {
    let result = String(name || '');
    const list = Array.isArray(rules) ? rules : [];

    for (const rule of list) {
      if (!rule || rule.enabled === false) {
        continue;
      }

      if (rule.type === 'regex') {
        const pattern = String(rule.pattern || '');
        if (!pattern) {
          continue;
        }
        const re = new RegExp(pattern, rule.flags || '');
        result = result.replace(re, rule.replace ?? '');
        continue;
      }

      if (rule.type === 'text') {
        const search = String(rule.search ?? '');
        if (!search) {
          continue;
        }
        result = result.split(search).join(rule.replace ?? '');
      }
    }

    if (options.trimResult !== false && CONFIG.rename.trimResult) {
      result = result.trim();
    }
    return result;
  }

  function applyRules(name, item) {
    return applyRulesWithRuleSet(name, CONFIG.rename.rules, {
      trimResult: CONFIG.rename.trimResult,
    });
  }

  function getDefaultExampleName() {
    const captured = getCapturedItems().find((item) => item && item.name);
    if (captured && captured.name) {
      return String(captured.name);
    }
    return '[高清剧集网]访达[全12集].2025.2160p.WEB-DL.H265.AAC-ColorTV';
  }

  function getPanelFirstRuleDraft() {
    const ruleMode = UI.fields.ruleMode?.value || getCurrentRuleMode();
    const rule = {
      enabled: ruleMode !== 'none',
      type: 'regex',
      pattern: '',
      flags: '',
      search: '',
      replace: '',
    };

    if (ruleMode === 'remove-leading-bracket') {
      rule.type = 'regex';
      rule.pattern = DEFAULT_LEADING_BRACKET_PATTERN;
      rule.flags = 'u';
      rule.replace = '';
      return rule;
    }

    if (ruleMode === 'replace-text') {
      rule.type = 'text';
      rule.search = String(UI.fields.ruleSearchText?.value || '');
      rule.replace = String(UI.fields.ruleReplaceText?.value || '');
      return rule;
    }

    if (ruleMode === 'custom-regex') {
      rule.type = 'regex';
      rule.pattern = String(UI.fields.rulePattern?.value || '');
      rule.flags = String(UI.fields.ruleFlags?.value || '');
      rule.replace = String(UI.fields.ruleReplace?.value || '');
      return rule;
    }

    return rule;
  }

  function getPanelOutputDraft() {
    const mode = UI.fields.outputMode?.value || ((CONFIG.rename.output || {}).mode || 'keep-clean');
    return {
      mode,
      addText: String(UI.fields.addText?.value || ''),
      addPosition: String(UI.fields.addPosition?.value || 'suffix'),
      findText: String(UI.fields.outputFindText?.value || ''),
      replaceText: String(UI.fields.outputReplaceText?.value || ''),
      formatStyle: String(UI.fields.formatStyle?.value || 'text-and-index'),
      formatText: String(UI.fields.formatText?.value || ''),
      formatPosition: String(UI.fields.formatPosition?.value || 'suffix'),
      startIndex: Number(UI.fields.startIndex?.value || 0),
      template: String(UI.fields.template?.value || '{clean}').trim() || '{clean}',
    };
  }

  function buildFinalNameFromDraft(original, clean, fileId, output, renameIndex = 0) {
    const ext = getExt(clean);
    const base = getBaseName(clean);
    const serial = Number(output.startIndex || 0) + Number(renameIndex || 0);

    if (output.mode === 'add-text') {
      if (!output.addText) {
        return clean;
      }
      return output.addPosition === 'prefix' ? `${output.addText}${clean}` : `${clean}${output.addText}`;
    }

    if (output.mode === 'replace-text') {
      if (!output.findText) {
        return clean;
      }
      return clean.split(output.findText).join(output.replaceText || '');
    }

    if (output.mode === 'format') {
      const formatText = String(output.formatText || '').trim() || '文件';
      if (output.formatStyle === 'text-only') {
        return formatText;
      }
      return output.formatPosition === 'prefix' ? `${serial}${formatText}` : `${formatText}${serial}`;
    }

    if (output.mode === 'custom-template') {
      return renderTemplate(output.template || '{clean}', {
        original,
        clean,
        base,
        ext,
        fileId,
        index: serial,
      });
    }

    return clean;
  }

  function getPanelPreviewDraft() {
    return {
      ruleMode: UI.fields.ruleMode?.value || getCurrentRuleMode(),
      outputMode: UI.fields.outputMode?.value || ((CONFIG.rename.output || {}).mode || 'keep-clean'),
      firstRule: getPanelFirstRuleDraft(),
      output: getPanelOutputDraft(),
    };
  }

  function getRenameExampleDescription(draft) {
    if (draft.ruleMode === 'replace-text') {
      const search = String(draft.firstRule.search || '');
      const replace = String(draft.firstRule.replace || '');
      if (search) {
        return replace ? `预处理会把所有“${search}”替换成“${replace}”。` : `预处理会删除所有“${search}”。`;
      }
    }

    if (draft.output.mode === 'add-text') {
      return draft.output.addText
        ? `最终会在名字${draft.output.addPosition === 'prefix' ? '前面' : '后面'}增加“${draft.output.addText}”。`
        : '增加文字模式下，先填写要增加的内容。';
    }

    if (draft.output.mode === 'replace-text') {
      return draft.output.findText
        ? `最终会把名字里的所有“${draft.output.findText}”替换成“${draft.output.replaceText || ''}”。`
        : '替换文字模式下，先填写“查找文本”。';
    }

    if (draft.output.mode === 'format') {
      return draft.output.formatStyle === 'text-only'
        ? '格式命名会把名字统一改成你填写的“自定义格式”。'
        : '格式命名会按“自定义格式 + 序号”来生成新名字。';
    }

    if (draft.output.mode === 'custom-template') {
      return '高级模板模式会按你填写的模板生成名字，比如 {clean}、{original}、{index}。';
    }

    return '最终会直接使用“预处理后”的名字。';
  }

  function updateRenameModePreview() {
    if (!UI.root) {
      return;
    }

    const ruleMode = UI.fields.ruleMode?.value || getCurrentRuleMode();
    const outputMode = UI.fields.outputMode?.value || ((CONFIG.rename.output || {}).mode || 'keep-clean');
    const advanced = UI.root.querySelector('[data-role="advanced-details"]');
    if (advanced && (ruleMode === 'custom-regex' || outputMode === 'custom-template')) {
      advanced.open = true;
    }

    UI.root.querySelectorAll('[data-role="rule-text-group"]').forEach((node) => {
      node.style.display = ruleMode === 'replace-text' ? '' : 'none';
    });
    UI.root.querySelectorAll('[data-role="output-add-group"]').forEach((node) => {
      node.style.display = outputMode === 'add-text' ? '' : 'none';
    });
    UI.root.querySelectorAll('[data-role="output-replace-group"]').forEach((node) => {
      node.style.display = outputMode === 'replace-text' ? '' : 'none';
    });
    UI.root.querySelectorAll('[data-role="output-format-group"]').forEach((node) => {
      node.style.display = outputMode === 'format' ? '' : 'none';
    });
    UI.root.querySelectorAll('[data-role="output-template-group"]').forEach((node) => {
      node.style.display = outputMode === 'custom-template' ? '' : 'none';
    });

    const exampleField = UI.fields.exampleName;
    if (exampleField && !String(exampleField.value || '').trim()) {
      exampleField.value = getDefaultExampleName();
    }
    const original = String(exampleField?.value || getDefaultExampleName());
    const draft = getPanelPreviewDraft();
    const clean = applyRulesWithRuleSet(original, [draft.firstRule], {
      trimResult: CONFIG.rename.trimResult,
    });
    const finalName = buildFinalNameFromDraft(original, clean, 'demo', draft.output, 0);

    const desc = UI.root.querySelector('[data-role="rename-example-desc"]');
    const cleanEl = UI.root.querySelector('[data-role="rename-example-clean"]');
    const finalEl = UI.root.querySelector('[data-role="rename-example-final"]');

    if (desc) {
      desc.textContent = getRenameExampleDescription(draft);
    }
    if (cleanEl) {
      cleanEl.textContent = clean || '(空)';
    }
    if (finalEl) {
      finalEl.textContent = finalName || '(空)';
    }
  }

  function guessItemIsDirectory(obj, name = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return false;
    }

    const ext = String(getExt(name) || '').replace(/^\./, '').toLowerCase();
    if (ext && (
      KNOWN_FILE_EXTENSIONS.has(ext)
      || CLOUD_VIDEO_EXTENSIONS.has(ext)
      || CLOUD_JUNK_EXTENSIONS.has(ext)
      || EMPTY_SCAN_EXTRA_FILE_EXTENSIONS.has(ext)
    )) {
      return false;
    }

    const explicit = [
      obj.isDir,
      obj.is_dir,
      obj.isFolder,
      obj.is_folder,
      obj.folder,
      obj.directory,
      obj.dir,
    ].map((value) => normalizeBooleanish(value)).find((value) => value != null);
    if (explicit != null) {
      return explicit;
    }

    const dirType = toFiniteNumberOrNull(obj.dirType ?? obj.dir_type);
    if (dirType != null) {
      return dirType > 0;
    }

    if (
      hasMeaningfulDirectoryValue(obj.dirName)
      || hasMeaningfulDirectoryValue(obj.dir_name)
      || hasMeaningfulDirectoryValue(obj.folderName)
      || hasMeaningfulDirectoryValue(obj.folder_name)
      || hasMeaningfulDirectoryValue(obj.folderId)
      || hasMeaningfulDirectoryValue(obj.folder_id)
      || hasDirectoryCountHint(obj.childCount)
      || hasDirectoryCountHint(obj.childrenCount)
      || hasDirectoryCountHint(obj.children_count)
      || hasDirectoryCountHint(obj.dirCount)
      || hasDirectoryCountHint(obj.dir_count)
      || hasDirectoryCountHint(obj.folderCount)
      || hasDirectoryCountHint(obj.folder_count)
      || hasDirectoryCountHint(obj.subCount)
      || hasDirectoryCountHint(obj.sub_count)
      || hasMeaningfulDirectoryValue(obj.dirId)
      || hasMeaningfulDirectoryValue(obj.dir_id)
    ) {
      return true;
    }

    const typeHints = [
      obj.itemType,
      obj.item_type,
      obj.nodeType,
      obj.node_type,
      obj.resourceType,
      obj.resource_type,
      obj.resType,
      obj.res_type,
      obj.fileType,
      obj.file_type,
      obj.type,
      obj.kind,
      obj.bizType,
      obj.biz_type,
    ];

    for (const hint of typeHints) {
      if (hint == null || hint === '') {
        continue;
      }
      const text = String(hint).trim().toLowerCase();
      if (!text) {
        continue;
      }
      if (/(dir|folder|directory|catalog)/i.test(text)) {
        return true;
      }
      if (/(file|video|image|audio|doc|text|subtitle|torrent)/i.test(text)) {
        return false;
      }
    }

    if (obj.folderId != null || obj.folder_id != null) {
      return !getExt(name);
    }

    return false;
  }

  function extractDirectoryIdCandidates(obj, fallbackId = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return normalizeIdCandidates([fallbackId]);
    }
    return normalizeIdCandidates([
      obj.dirId,
      obj.dir_id,
      obj.folderId,
      obj.folder_id,
      obj.fileId,
      obj.id,
      obj.resourceId,
      obj.resId,
      obj.bizId,
      obj.objId,
      obj.shareFileId,
      obj.share_file_id,
      ...collectIdLikeValues(obj),
      fallbackId,
    ]);
  }

  function normalizeItem(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return null;
    }

    const fileId = obj.fileId ?? obj.id ?? obj.resourceId ?? obj.resId ?? obj.bizId ?? obj.objId ?? obj.shareFileId ?? obj.share_file_id ?? obj.dirId ?? obj.dir_id ?? obj.folderId ?? obj.folder_id;
    const dirIdCandidates = extractDirectoryIdCandidates(obj, fileId);
    const dirId = dirIdCandidates[0] || fileId;
    const name = chooseBestNameCandidate([
      obj.name,
      obj.fileName,
      obj.file_name,
      obj.filename,
      obj.resName,
      obj.resourceName,
      obj.title,
      obj.displayName,
      obj.display_name,
      obj.originalName,
      obj.original_name,
      obj.fileFullName,
      obj.fullName,
    ]) || chooseBestNameCandidate([
      obj.dirName,
      obj.dir_name,
      obj.folderName,
      obj.folder_name,
    ]);

    if ((typeof fileId === 'string' || typeof fileId === 'number') && typeof name === 'string') {
      return {
        fileId: String(fileId),
        dirId: dirId == null ? String(fileId) : String(dirId),
        dirIdCandidates,
        name,
        parentId: String(obj.parentId ?? obj.parent_id ?? obj.pid ?? obj.parentFileId ?? obj.parent_file_id ?? ''),
        isDir: guessItemIsDirectory(obj, name),
        raw: obj,
      };
    }

    return null;
  }

  function scanItems(node, out = []) {
    if (!node || typeof node !== 'object') {
      return out;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        scanItems(item, out);
      }
      return out;
    }

    const normalized = normalizeItem(node);
    if (normalized) {
      out.push(normalized);
    }

    for (const value of Object.values(node)) {
      scanItems(value, out);
    }

    return out;
  }

  function dedupeItems(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      if (!item || seen.has(item.fileId)) {
        continue;
      }
      seen.add(item.fileId);
      out.push(item);
    }
    return out;
  }

  function normalizeItemsFromArray(items = []) {
    return dedupeItems(
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeItem(item))
        .filter(Boolean)
    );
  }

  function isLikelyListArrayKey(key = '') {
    const text = String(key || '').trim().toLowerCase();
    if (!text) {
      return false;
    }
    return /^(data|list|items|rows|records|files|filelist|file_list|children|child_list|childlist|result)$/i.test(text)
      || /(list|item|row|record|file|child|result)s?$/i.test(text);
  }

  function collectItemArrayCandidates(node, out = [], options = {}) {
    const seen = options.seen || new WeakSet();
    const pathKeys = Array.isArray(options.pathKeys) ? options.pathKeys : [];
    const depth = Number(options.depth || 0);
    if (!node || typeof node !== 'object' || depth > 5) {
      return out;
    }
    if (seen.has(node)) {
      return out;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      const normalizedItems = normalizeItemsFromArray(node);
      const lastKey = String(pathKeys[pathKeys.length - 1] || '').trim();
      const likelyKey = isLikelyListArrayKey(lastKey);
      const pathBonus = pathKeys.some((key) => isLikelyListArrayKey(key)) ? 40 : 0;
      const dataBonus = pathKeys[0] === 'data' ? 30 : 0;
      const sizeBonus = normalizedItems.length;

      if (normalizedItems.length || likelyKey || node.length === 0) {
        out.push({
          items: normalizedItems,
          score: sizeBonus + (likelyKey ? 200 : 0) + pathBonus + dataBonus,
          isExplicitEmpty: node.length === 0 && likelyKey,
          path: pathKeys.join('.'),
        });
      }

      for (const item of node) {
        if (item && typeof item === 'object') {
          collectItemArrayCandidates(item, out, {
            seen,
            pathKeys,
            depth: depth + 1,
          });
        }
      }
      return out;
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      collectItemArrayCandidates(value, out, {
        seen,
        pathKeys: [...pathKeys, key],
        depth: depth + 1,
      });
    }
    return out;
  }

  function pickBestItemArrayCandidate(payload) {
    const candidates = collectItemArrayCandidates(payload);
    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.isExplicitEmpty !== right.isExplicitEmpty) {
        return Number(right.isExplicitEmpty) - Number(left.isExplicitEmpty);
      }
      return String(left.path || '').length - String(right.path || '').length;
    });

    return candidates[0] || null;
  }

  function extractItemsFromPayload(payload) {
    const explicitCandidate = pickBestItemArrayCandidate(payload);
    if (explicitCandidate) {
      return explicitCandidate.items;
    }
    return dedupeItems(scanItems(payload));
  }

  function looksLikeListRequest(url, requestBody) {
    if (typeof url === 'string' && /get_file_list|list|share/i.test(url)) {
      return true;
    }

    if (!requestBody || typeof requestBody !== 'object') {
      return false;
    }

    return ['parentId', 'pageSize', 'pageNum', 'pageNo', 'sortType', 'orderBy'].some((key) =>
      Object.prototype.hasOwnProperty.call(requestBody, key)
    );
  }

  function looksLikeListResponse(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    return extractItemsFromPayload(payload).length > 0;
  }

  function isLikelyListCapture(url, requestBody, responseBody) {
    return looksLikeListRequest(url, requestBody) || looksLikeListResponse(responseBody);
  }

  function normalizeDomName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function getVisibleNodeText(node) {
    if (!node) {
      return '';
    }
    return normalizeDomName(node.textContent || node.innerText || '');
  }

  function cleanDirectoryTitleCandidate(text) {
    const value = normalizeDomName(text)
      .replace(/\s*[-|｜丨]\s*光鸭云盘.*$/u, '')
      .replace(/\s*[-|｜丨]\s*www\.guangyapan\.com.*$/iu, '')
      .trim();
    return value;
  }

  function getCurrentDirectoryDisplayName() {
    const selectors = [
      '[aria-label*="breadcrumb" i] [aria-current="page"]',
      '[class*="breadcrumb"] [aria-current="page"]',
      '[class*="crumb"] [aria-current="page"]',
      '[class*="breadcrumb"] [class*="item"]:last-child',
      '[class*="crumb"] [class*="item"]:last-child',
      '[class*="path"] [class*="name"]:last-child',
      '[class*="path"] [class*="item"]:last-child',
      'nav [aria-current="page"]',
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes.reverse()) {
        const text = cleanDirectoryTitleCandidate(getVisibleNodeText(node));
        if (isProbablyUsefulName(text) && !/^光鸭云盘工具$/u.test(text)) {
          return text;
        }
      }
    }

    const title = cleanDirectoryTitleCandidate(document.title || '');
    if (isProbablyUsefulName(title) && !/^(光鸭云盘|首页|我的网盘)$/u.test(title)) {
      return title;
    }

    return '(当前目录)';
  }

  function isHelperPanelNode(node) {
    return Boolean(node && typeof node.closest === 'function' && node.closest('#gyp-batch-rename-root'));
  }

  function isSyntheticDomId(value) {
    return /^dom(?:dir)?:/u.test(String(value || '').trim());
  }

  function isBreadcrumbContainerNode(node) {
    return Boolean(
      node
      && typeof node.closest === 'function'
      && node.closest('[aria-label*="breadcrumb" i], [class*="breadcrumb"], [class*="crumb"], [class*="path"], nav')
    );
  }

  function isLikelyListHeaderRow(row) {
    const text = normalizeDomName(row?.innerText || row?.textContent || '');
    if (!text) {
      return false;
    }

    if (/^(文件名称|大小|类型|修改时间)(\s+(文件名称|大小|类型|修改时间))+$/u.test(text)) {
      return true;
    }

    return ['文件名称', '大小', '类型', '修改时间'].every((keyword) => text.includes(keyword)) && text.length <= 40;
  }

  function isUsableListRow(row) {
    if (!row || !isVisibleElement(row) || isHelperPanelNode(row) || isBreadcrumbContainerNode(row) || isLikelyListHeaderRow(row)) {
      return false;
    }

    const text = normalizeDomName(row.innerText || row.textContent || '');
    if (!text) {
      return false;
    }

    return true;
  }

  async function waitForCondition(check, options = {}) {
    const timeoutMs = Math.max(200, Number(options.timeoutMs || 3000));
    const intervalMs = Math.max(60, Number(options.intervalMs || 120));
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      try {
        const result = check();
        if (result) {
          return result;
        }
      } catch {}
      await sleep(intervalMs);
    }

    return null;
  }

  function getDirectoryContextSnapshot() {
    const context = getCurrentListContext();
    return {
      parentId: String(context.parentId || STATE.lastCapturedParentId || '').trim(),
      name: String(getCurrentDirectoryDisplayName() || '(当前目录)').trim() || '(当前目录)',
      url: String(location.href || ''),
      hash: String(location.hash || ''),
      capturedAt: Number(STATE.lastListCapturedAt || 0),
    };
  }

  function isSameDirectorySnapshot(left, right) {
    if (!left || !right) {
      return false;
    }

    const leftParentId = String(left.parentId || '').trim();
    const rightParentId = String(right.parentId || '').trim();
    if (leftParentId && rightParentId) {
      return leftParentId === rightParentId;
    }

    const leftName = normalizeDomName(left.name);
    const rightName = normalizeDomName(right.name);
    if (leftName && rightName && leftName !== rightName) {
      return false;
    }

    const leftUrl = String(left.url || '');
    const rightUrl = String(right.url || '');
    if (leftUrl && rightUrl) {
      return leftUrl === rightUrl;
    }

    return Boolean(leftName && rightName && leftName === rightName);
  }

  function hasDirectoryContextChanged(previous, current) {
    if (!previous || !current) {
      return false;
    }

    const previousParentId = String(previous.parentId || '').trim();
    const currentParentId = String(current.parentId || '').trim();
    if (previousParentId && currentParentId) {
      return previousParentId !== currentParentId;
    }

    const previousUrl = String(previous.url || '');
    const currentUrl = String(current.url || '');
    const previousName = normalizeDomName(previous.name);
    const currentName = normalizeDomName(current.name);
    const urlChanged = Boolean(previousUrl && currentUrl && previousUrl !== currentUrl);
    const nameChanged = Boolean(previousName && currentName && previousName !== currentName);
    if (!urlChanged && !nameChanged) {
      return false;
    }

    return Number(current.capturedAt || 0) > Number(previous.capturedAt || 0);
  }

  function findVisibleEmptyStateInfo() {
    const selectors = [
      '.ant-empty',
      '.arco-empty',
      '[class*="empty"]',
      '[class*="blank"]',
      '[class*="no-data"]',
      '[class*="nodata"]',
      '[class*="zero-state"]',
      '[data-empty]',
      '[data-status="empty"]',
      '[aria-label*="空"]',
    ];

    const selectorNodes = dedupeElements(Array.from(document.querySelectorAll(selectors.join(', '))))
      .filter((node) => isVisibleElement(node) && !isHelperPanelNode(node));
    for (const node of selectorNodes) {
      const text = normalizeDomName(node.innerText || node.textContent || '');
      const matched = EMPTY_STATE_TEXT_PATTERNS.find((pattern) => pattern.test(text));
      if (matched || !text) {
        return {
          visible: true,
          text: text || '(空态组件)',
          via: 'selector',
        };
      }
    }

    const roots = dedupeElements([
      findScrollableListContainer(),
      findScrollableListContainer()?.parentElement,
      document.body,
    ]).filter((node) => node && !isHelperPanelNode(node));

    for (const root of roots) {
      const text = normalizeDomName(root?.innerText || root?.textContent || '');
      const matched = EMPTY_STATE_TEXT_PATTERNS.find((pattern) => pattern.test(text));
      if (matched) {
        return {
          visible: true,
          text: matched.exec(text)?.[0] || matched.source,
          via: 'text',
        };
      }
    }

    return {
      visible: false,
      text: '',
      via: '',
    };
  }

  async function waitForDirectoryChange(previousSnapshot, options = {}) {
    return waitForCondition(() => {
      const currentSnapshot = getDirectoryContextSnapshot();
      return hasDirectoryContextChanged(previousSnapshot, currentSnapshot) ? currentSnapshot : null;
    }, options);
  }

  async function waitForDirectoryMatch(targetSnapshot, options = {}) {
    return waitForCondition(() => {
      const currentSnapshot = getDirectoryContextSnapshot();
      return isSameDirectorySnapshot(targetSnapshot, currentSnapshot) ? currentSnapshot : null;
    }, options);
  }

  function normalizeHashRoute(hash) {
    const text = String(hash || '').trim();
    if (!text) {
      return '';
    }
    return text.startsWith('#') ? text : `#${text.replace(/^#*/, '')}`;
  }

  function extractDirectoryIdFromHashSegment(segment) {
    const matched = String(segment || '').trim().match(/^(\d{8,})-/u);
    return matched ? String(matched[1] || '') : '';
  }

  function getCurrentDirectoryParentIdFromHash(hash = location.hash) {
    const normalizedHash = normalizeHashRoute(hash).replace(/^#\/?/u, '');
    const segments = normalizedHash.split('/').filter(Boolean);
    const ids = segments.map((segment) => extractDirectoryIdFromHashSegment(segment)).filter(Boolean);
    if (ids.length < 2) {
      return '';
    }
    return String(ids[ids.length - 2] || '').trim();
  }

  function buildChildDirectoryHash(previousSnapshot, childItem) {
    const childId = String(childItem?.fileId || childItem?.dirId || '').trim();
    const childName = String(childItem?.name || '').trim();
    if (!childId || isSyntheticDomId(childId) || !childName) {
      return '';
    }

    const baseHash = normalizeHashRoute(previousSnapshot?.hash || location.hash || '');
    if (!baseHash) {
      return '';
    }

    const cleanBase = baseHash.replace(/\/+$/u, '');
    const encodedName = encodeURIComponent(childName);
    const segment = `${childId}-${encodedName}`;
    return `${cleanBase}/${segment}`;
  }

  async function navigateToDirectoryHash(targetHash, previousSnapshot, options = {}) {
    const normalizedHash = normalizeHashRoute(targetHash);
    if (!normalizedHash || normalizeHashRoute(previousSnapshot?.hash || '') === normalizedHash) {
      return null;
    }

    try {
      location.hash = normalizedHash;
    } catch {
      return null;
    }

    await waitForCondition(() => normalizeHashRoute(location.hash) === normalizedHash, {
      timeoutMs: 800,
      intervalMs: 80,
    });

    return waitForFreshDirectoryContext(previousSnapshot, {
      expectedName: options.expectedName || '',
      timeoutMs: Number(options.timeoutMs || 4200),
      intervalMs: Number(options.intervalMs || 180),
      stableMs: Number(options.stableMs || 420),
    });
  }

  async function waitForFreshDirectoryContext(previousSnapshot, options = {}) {
    const timeoutMs = Math.max(400, Number(options.timeoutMs || 2600));
    const intervalMs = Math.max(80, Number(options.intervalMs || 180));
    const stableMs = Math.max(intervalMs, Number(options.stableMs || 360));
    const expectedName = normalizeDomName(options.expectedName || '');
    const previousParentId = String(previousSnapshot?.parentId || '').trim();
    const deadline = Date.now() + timeoutMs;
    let candidate = null;
    let candidateAt = 0;

    while (Date.now() <= deadline) {
      const snapshot = getDirectoryContextSnapshot();
      const currentParentId = String(snapshot.parentId || '').trim();
      const parentChanged = Boolean(currentParentId && currentParentId !== previousParentId && !isSyntheticDomId(currentParentId));
      const nameMatches = !expectedName
        || !snapshot.name
        || textLooksLikeExpected(snapshot.name, expectedName)
        || textLooksLikeExpected(expectedName, snapshot.name);

      if (parentChanged && nameMatches) {
        if (!candidate || candidate.parentId !== currentParentId) {
          candidate = snapshot;
          candidateAt = Date.now();
        } else if (Date.now() - candidateAt >= stableMs) {
          return snapshot;
        }
      } else {
        candidate = null;
        candidateAt = 0;
      }

      await sleep(intervalMs);
    }

    return candidate;
  }

  function isProbablyUsefulName(name) {
    const text = normalizeDomName(name);
    if (!text) {
      return false;
    }

    const compact = text.replace(/\s+/gu, '');
    if (compact.length < 2 && !/^[A-Za-z0-9一-龥]$/u.test(compact)) {
      return false;
    }

    const blacklist = ['上传', '新建文件夹', '云添加', '文件', '文件名称', '大小', '类型', '文件夹', '其他', '未知类型', 'typeunknown', '-'];
    if (blacklist.includes(text)) {
      return false;
    }

    return true;
  }

  function isProbablyMetadataText(text) {
    const value = normalizeDomName(text);
    if (!value) {
      return true;
    }

    return (
      /^(type(?:unknown|file|folder|video|audio|image|document|other|torrent)|filetypeunknown)$/i.test(value) ||
      /^(其他|未知类型|文件类型)$/u.test(value) ||
      /^\d+(\.\d+)?\s*(B|KB|MB|GB|TB|PB)$/i.test(value) ||
      /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(value) ||
      /^(今天|昨天|刚刚|\d{1,2}:\d{2})$/.test(value) ||
      /^\d+$/.test(value)
    );
  }

  function rowHasFileSizeHint(row) {
    const text = normalizeDomName(row?.innerText || row?.textContent || '');
    if (!text) {
      return false;
    }
    return /\b\d+(?:\.\d+)?\s*(B|KB|MB|GB|TB|PB)\b/i.test(text);
  }

  function guessDomRowIsDirectory(row, name = '') {
    if (!row) {
      return false;
    }

    const folderSelectors = [
      '[data-type*="folder" i]',
      '[data-kind*="folder" i]',
      '[data-icon*="folder" i]',
      '[class*="folder"]',
      '[class*="dir-icon"]',
      '[class*="folder-icon"]',
      '[aria-label*="文件夹"]',
      '[title*="文件夹"]',
      'img[alt*="folder" i]',
      'img[alt*="文件夹"]',
      'img[src*="folder" i]',
      'svg[aria-label*="folder" i]',
    ];

    for (const selector of folderSelectors) {
      if (row.querySelector(selector)) {
        return true;
      }
    }

    const textCandidates = collectTextCandidates(row);
    if (textCandidates.some((text) => /^(文件夹|folder|directory)$/iu.test(text))) {
      return true;
    }

    const cleanName = normalizeDomName(name);
    if (cleanName && !getExt(cleanName) && !rowHasFileSizeHint(row)) {
      return true;
    }

    return false;
  }

  function collectTextCandidates(row) {
    const out = new Set();
    const push = (value) => {
      const text = normalizeDomName(value);
      if (!isProbablyUsefulName(text) || isProbablyMetadataText(text)) {
        return;
      }
      out.add(text);
    };

    if (!row) {
      return [];
    }

    push(row.getAttribute && row.getAttribute('title'));
    push(row.getAttribute && row.getAttribute('aria-label'));

    const attrNodes = Array.from(row.querySelectorAll('[title], [aria-label], [data-name], [data-filename]'));
    for (const node of attrNodes) {
      push(node.getAttribute && node.getAttribute('title'));
      push(node.getAttribute && node.getAttribute('aria-label'));
      push(node.getAttribute && node.getAttribute('data-name'));
      push(node.getAttribute && node.getAttribute('data-filename'));
    }

    const leafNodes = Array.from(row.querySelectorAll('span, div, p, a, strong, td'))
      .filter((el) => el && el.childElementCount === 0)
      .map((el) => el.textContent);
    for (const value of leafNodes) {
      push(value);
    }

    const rowText = String(row.innerText || row.textContent || '');
    for (const line of rowText.split(/\n+/)) {
      push(line);
    }

    return Array.from(out);
  }

  function findExpectedNameInRow(row, expectedSet) {
    if (!row || !expectedSet || !expectedSet.size) return '';

    const candidates = collectTextCandidates(row);

    for (const candidate of candidates) {
      const domName = normalizeDomName(candidate);
      for (const expected of expectedSet) {
        if (domName === expected) {
          return expected;
        }

        if (textLooksLikeExpected(domName, expected)) {
          return expected;
        }

        if ((domName.includes('...') || domName.length > 20) && expected.startsWith(domName.replace('...', ''))) {
          return expected;
        }

        if (expected.split('.')[0] === domName) {
          return expected;
        }
      }
    }
    return '';
  }

  function extractNameFromRow(row) {
    if (!row) {
      return '';
    }

    const candidates = collectTextCandidates(row)
      .sort((a, b) => b.length - a.length);

    return candidates[0] || '';
  }

  function collectDomItems() {
    const rows = Array.from(
      document.querySelectorAll('[role="row"], li, tr, [class*="row"], [class*="item"], [class*="file"]')
    );
    const items = [];
    const seen = new Set();

    rows.forEach((row, index) => {
      if (isHelperPanelNode(row)) {
        return;
      }

      const checkbox = row.querySelector(
        'input[type="checkbox"], [role="checkbox"], [class*="checkbox"], [class*="check"]'
      );
      if (!checkbox) {
        return;
      }

      const name = extractNameFromRow(row);
      if (!isProbablyUsefulName(name) || seen.has(name)) {
        return;
      }

      seen.add(name);
      items.push({
        fileId: `dom:${index}:${name}`,
        dirId: `dom:${index}:${name}`,
        dirIdCandidates: [`dom:${index}:${name}`],
        name,
        isDir: guessDomRowIsDirectory(row, name),
        raw: {
          fromDom: true,
          domIsDir: guessDomRowIsDirectory(row, name),
        },
      });
    });

    return items;
  }

  function collectVisibleDirectoryHints(expectedNames = []) {
    const expectedSet = new Set((expectedNames || []).map((name) => normalizeDomName(name)).filter(Boolean));
    if (!expectedSet.size) {
      return new Set();
    }

    const checkboxNodes = Array.from(document.querySelectorAll(
      'input[type="checkbox"], [role="checkbox"], [class*="checkbox"], [class*="check"]'
    ));
    const matched = new Set();

    for (const checkbox of checkboxNodes) {
      if (isHelperPanelNode(checkbox)) {
        continue;
      }

      let node = checkbox;
      let depth = 0;
      while (node && depth < 8) {
        const candidates = collectTextCandidates(node);
        const matchedName = candidates.find((text) => expectedSet.has(normalizeDomName(text)));
        if (matchedName) {
          const normalizedName = normalizeDomName(matchedName);
          if (guessDomRowIsDirectory(node, normalizedName)) {
            matched.add(normalizedName);
          }
          break;
        }
        node = node.parentElement;
        depth += 1;
      }
    }

    return matched;
  }

  function getUtils() {
    return {
      applyRules,
      getBaseName,
      getExt,
      renderTemplate,
    };
  }

  function buildNewName(item, context = {}) {
    const next = CONFIG.rename.buildName(item, getUtils(), context);
    return CONFIG.rename.trimResult ? String(next || '').trim() : String(next || '');
  }

  function buildTargets(items) {
    const targets = [];
    const usedNames = new Set();

    // 第一步：把所有“不改名”的文件名字存起来，作为不可占用的“坑位”
    items.forEach((item, index) => {
      const nextName = buildNewName(item, { renameIndex: index });
      const isSkipped = CONFIG.filter.predicate(item) === false;
      // 如果被过滤了，或者改名后和原名一样，那它现在的名字就是被占用的
      if (isSkipped || !nextName || nextName === item.name) {
        usedNames.add(item.name);
      }
    });

    // 第二步：处理需要改名的文件
    let renameIndex = 0;
    items.forEach((item) => {
      let finalName = buildNewName(item, { renameIndex });
      const isSkipped = CONFIG.filter.predicate(item) === false;

      if (isSkipped || !finalName || finalName === item.name) return;

      // 如果新名字冲突了，就循环加 (1), (2)...
      if (usedNames.has(finalName)) {
        let counter = 1;
        const base = getBaseName(finalName);
        const ext = getExt(finalName);
        let candidate = `${base}(${counter})${ext}`;

        while (usedNames.has(candidate)) {
          counter++;
          candidate = `${base}(${counter})${ext}`;
        }
        finalName = candidate;
      }

      // 把确定要用的新名字也存入占用列表，防止后续文件撞车
      usedNames.add(finalName);

      targets.push({
        fileId: item.fileId,
        oldName: item.name,
        newName: finalName,
        raw: item.raw,
      });
      renameIndex += 1;
    });

    return targets;
  }

  function getDuplicateRegex() {
    if (CONFIG.duplicate.mode === 'numbers') {
      return new RegExp(buildDuplicatePatternFromNumbers(CONFIG.duplicate.numbers), 'u');
    }
    return new RegExp(CONFIG.duplicate.pattern, CONFIG.duplicate.flags || '');
  }

  function buildDuplicateTargets(items) {
    const re = getDuplicateRegex();
    return items.filter((item) => {
      const isMatch = re.test(String(item.name || ''));
      if (isMatch && CONFIG.debug) {
        console.log(LOG_PREFIX, `[重复项匹配成功]: ${item.name}`);
      }
      return isMatch;
    });
  }

  function resolveListBody(overrideBody = {}) {
    // 基础数据优先从上次捕获中拿，保证 parentId 等参数正确
    let body = sanitizeListBody(
      (STATE.lastListBody && Object.keys(STATE.lastListBody).length > 0)
        ? STATE.lastListBody
        : CONFIG.request.manualListBody
    );

    for (const [key, value] of Object.entries(overrideBody || {})) {
      if (value !== '' && value != null) {
        body[key] = value;
      }
    }

    body = sanitizeListBody(body);

    // 刷新预览时要回到当前目录第一页，不能沿用滚动加载时的分页游标。
    const manualSize = Number(UI.fields.pageSize?.value || body.pageSize || CONFIG.request.manualListBody.pageSize || 100);
    if (manualSize > 0) {
      body.pageSize = manualSize;
    }

    if (!body.parentId) {
      body.parentId = normalizeParentId(CONFIG.request.manualListBody.parentId);
    }

    return body;
  }

  function normalizePageRequestOptions(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const normalized = {};
    const stringFields = ['method', 'mode', 'credentials', 'cache', 'redirect', 'referrer', 'referrerPolicy'];

    for (const key of stringFields) {
      if (typeof source[key] === 'string' && source[key]) {
        normalized[key] = source[key];
      }
    }

    if (typeof source.keepalive === 'boolean') {
      normalized.keepalive = source.keepalive;
    }

    const headers = sanitizeHeaders(source.headers);
    if (Object.keys(headers).length) {
      normalized.headers = headers;
    }

    if (typeof source.body === 'string') {
      normalized.body = source.body;
    }

    return normalized;
  }

  function pageRequest(url, options = {}) {
    const normalizedOptions = normalizePageRequestOptions(options);

    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error(`未检测到 GM_xmlhttpRequest 权限 | ${normalizedOptions.method || 'GET'} ${url}`));
        return;
      }

      try {
        GM_xmlhttpRequest({
          method: normalizedOptions.method || 'GET',
          url: String(url),
          headers: normalizedOptions.headers || {},
          data: typeof normalizedOptions.body === 'string' ? normalizedOptions.body : undefined,
          timeout: 30000,
          anonymous: false,
          onload: (res) => {
            resolve({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              text: typeof res.responseText === 'string' ? res.responseText : '',
              via: 'GM_xmlhttpRequest',
            });
          },
          onerror: (err) => {
            reject(
              new Error(
                `GM_xmlhttpRequest 网络请求异常 (${getErrorText(err) || '未知错误'}) | ${normalizedOptions.method || 'GET'} ${url}`
              )
            );
          },
          ontimeout: () => {
            reject(new Error(`GM_xmlhttpRequest 请求超时 | ${normalizedOptions.method || 'GET'} ${url}`));
          },
          onabort: () => {
            reject(new Error(`GM_xmlhttpRequest 请求被中止 | ${normalizedOptions.method || 'GET'} ${url}`));
          },
        });
      } catch (err) {
        reject(new Error(`${getErrorText(err) || 'GM_xmlhttpRequest 调用失败'} | ${normalizedOptions.method || 'GET'} ${url}`));
      }
    });
  }

  async function requestListBatch(overrideBody = {}) {
    const headers = getRequestHeaders();
    const body = resolveListBody(overrideBody);
    if (Object.prototype.hasOwnProperty.call(overrideBody || {}, 'page')) {
      body.page = overrideBody.page;
    }
    const listUrl = STATE.lastListUrl || `${CONFIG.request.apiHost}${CONFIG.request.listPath}`;

    if (!body.parentId) {
      throw new Error('没有拿到 parentId。请先打开目标目录等待列表加载，或在 CONFIG.request.manualListBody.parentId 里手填。');
    }

    const response = await pageRequest(listUrl, {
      method: 'POST',
      headers,
      mode: 'cors',
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`获取列表失败：HTTP ${response.status}`);
    }

    const payload = safeJsonParse(response.text);
    if (!payload) {
      throw new Error('获取列表失败：响应不是有效 JSON');
    }

    return {
      headers,
      body,
      listUrl,
      response,
      payload,
      items: extractItemsFromPayload(payload),
    };
  }

  async function fetchCurrentList(overrideBody = {}) {
    const override = overrideBody && typeof overrideBody === 'object' ? { ...overrideBody } : {};
    const returnBatchOnly = Boolean(override.__returnBatchOnly);
    delete override.__returnBatchOnly;

    const { body, listUrl, payload, items } = await requestListBatch(override);
    const merged = mergeCapturedItems(body.parentId, items, {
      listUrl,
      requestBody: body,
    });

    STATE.lastListUrl = listUrl;
    STATE.lastListBody = body;
    STATE.lastListResponse = payload;
    STATE.lastListItems = merged.items;
    STATE.lastCapturedParentId = normalizeParentId(body.parentId);
    STATE.lastItemsSource = merged.batchCount > 1 ? 'api-merged' : 'api';

    log(`重新拉取列表完成：本批 ${items.length} 项，当前目录累计 ${merged.total} 项（共 ${merged.batchCount} 批）。`);
    return returnBatchOnly ? items : merged.items;
  }

  function getCapturedItems() {
    const stats = getCapturedListStats();
    const bucket = getCapturedListBucket(stats.parentId, { create: false });
    if (bucket && Array.isArray(bucket.items) && bucket.items.length) {
      return bucket.items;
    }
    return Array.isArray(STATE.lastListItems) ? STATE.lastListItems : [];
  }

  function buildCurrentDirectoryItemsSnapshot(parentId = '') {
    const currentParentId = String(getCurrentListContext().parentId || '').trim();
    const targetParentId = String(parentId || '').trim();
    if (!currentParentId || !targetParentId || currentParentId !== targetParentId) {
      return [];
    }

    const captured = Array.isArray(getCapturedItems()) ? getCapturedItems() : [];
    if (!captured.length) {
      return [];
    }

    const visibleDirNames = collectVisibleDirectoryHints(captured.map((item) => item?.name || ''));
    const domItems = collectDomItems();
    const domByName = new Map(
      (domItems || [])
        .filter((item) => item && item.name)
        .map((item) => [normalizeDomName(item.name), item])
    );

    return dedupeItems(captured.map((item) => {
      const key = normalizeDomName(item?.name || '');
      const domItem = key ? domByName.get(key) : null;
      if (!visibleDirNames.has(key) && !domItem?.isDir) {
        return item;
      }
      return {
        ...item,
        isDir: true,
        dirIdCandidates: normalizeIdCandidates(item?.dirIdCandidates || [item?.dirId, item?.fileId]),
        raw: {
          ...(item.raw || {}),
          domIsDir: true,
        },
      };
    }));
  }

  function shouldTreatItemAsDirectory(item) {
    if (!item) {
      return false;
    }
    if (item.isDir === true) {
      return true;
    }
    return guessItemIsDirectory(item.raw || {}, item.name || '');
  }

  function getDomItems() {
    const items = collectDomItems();
    if (items.length) {
      STATE.lastItemsSource = 'dom';
    }
    return items;
  }

  async function getPreviewItems(options = {}) {
    const refresh = Boolean(options.refresh);
    const overrideBody = options.listBody || {};

    if (refresh) {
      try {
        const apiItems = await fetchCurrentList(overrideBody);
        if (apiItems.length) {
          return apiItems;
        }
      } catch (err) {
        warn('接口刷新列表失败，改用页面可见项目兜底：', err);
      }
    }

    const captured = getCapturedItems();
    if (captured.length) {
      return captured;
    }

    const domItems = getDomItems();
    if (domItems.length) {
      warn('当前未捕获到接口列表，已退回到页面可见项目模式。此模式可做预览和勾选重复项，但不能直接执行改名。');
      return domItems;
    }

    return [];
  }

  function summarizeTargets(targets) {
    const rows = targets.map((item) => ({
      fileId: item.fileId,
      oldName: item.oldName,
      newName: item.newName,
    }));
    console.table(rows);

    const duplicateNames = {};
    for (const item of targets) {
      duplicateNames[item.newName] = (duplicateNames[item.newName] || 0) + 1;
    }
    const collisions = Object.entries(duplicateNames)
      .filter(([, count]) => count > 1)
      .map(([name, count]) => ({ newName: name, count }));

    if (collisions.length) {
      warn('检测到潜在重名，相关项目可能改名失败：');
      console.table(collisions);
    }
  }

  function logZeroPreviewDiagnostics(items) {
    if (!items.length) {
      return;
    }

    const samples = items.slice(0, 8).map((item, index) => {
      const original = String(item.name || '');
      const clean = applyRules(original, item);
      const finalName = buildNewName(item, { renameIndex: index });
      return {
        fileId: item.fileId,
        original,
        clean,
        finalName,
        startsWithBracket: /^\s*[\[【]/.test(original),
      };
    });

    const leadingBracketCount = items.filter((item) => /^\s*[\[【]/.test(String(item?.name || ''))).length;
    console.table(samples);
    warn(`预览结果为 0。当前目录累计 ${items.length} 项，其中 ${leadingBracketCount} 项以 [] / 【】 开头；已在控制台输出诊断样本。`);
  }

  function isProbablySuccess(payload, response) {
    if (!response.ok) {
      return false;
    }
    if (!payload || typeof payload !== 'object') {
      return true;
    }
    if (payload.success === false) {
      return false;
    }
    if (payload.status === 'error') {
      return false;
    }
    if ('code' in payload) {
      const code = String(payload.code);
      if (!['0', '200', '2000'].includes(code) && !code.startsWith('2')) {
        return false;
      }
    }
    return true;
  }

  async function renameOne(target) {
    const response = await pageRequest(getRenameUrl(), {
      method: 'POST',
      headers: getRenameHeaders(),
      mode: 'cors',
      credentials: 'include',
      body: JSON.stringify(buildRenamePayload(target)),
    });

    const text = response.text || '';
    const payload = safeJsonParse(text);
    return {
      ok: isProbablySuccess(payload, response),
      status: response.status,
      text,
      payload,
    };
  }

  async function preview(options = {}) {
    const items = await getPreviewItems(options);

    if (!items.length) {
      warn('当前没有拿到可用项目。先刷新当前分享目录，再试一次。');
      return [];
    }

    const targets = buildTargets(items);
    if (!targets.length) {
      logZeroPreviewDiagnostics(items);
    }
    summarizeTargets(targets);
    log(`预览完成：当前共 ${targets.length} 个项目将被改名。`);
    return targets;
  }

  async function previewDuplicates(options = {}) {
    const items = await getPreviewItems(options);

    if (!items.length) {
      warn('当前没有拿到可用项目。先刷新当前分享目录，再试一次。');
      return [];
    }

    const duplicates = buildDuplicateTargets(items).map((item) => ({
      fileId: item.fileId,
      name: item.name,
    }));

    console.table(duplicates);
    log(`重复项预览完成：共 ${duplicates.length} 个项目匹配尾部 (1)/(2)/(3) 规则。`);
    return duplicates;
  }

  function resolveItemsByName(previewItems, sourceItems) {
    const exactMap = new Map();

    for (const item of sourceItems || []) {
      if (!item || !item.fileId || String(item.fileId).startsWith('dom:')) {
        continue;
      }
      const key = normalizeDomName(item.name);
      if (!key) {
        continue;
      }
      if (!exactMap.has(key)) {
        exactMap.set(key, []);
      }
      exactMap.get(key).push(item);
    }

    const merged = [];
    const resolved = [];
    const unresolved = [];

    for (const item of previewItems || []) {
      if (!item) {
        continue;
      }

      if (item.fileId && !String(item.fileId).startsWith('dom:')) {
        const normalized = {
          fileId: String(item.fileId),
          name: String(item.name || ''),
        };
        merged.push(normalized);
        resolved.push(normalized);
        continue;
      }

      const key = normalizeDomName(item.name);
      const matches = key ? (exactMap.get(key) || []) : [];
      if (matches.length === 1) {
        const normalized = {
          fileId: String(matches[0].fileId),
          name: String(matches[0].name || item.name || ''),
        };
        merged.push(normalized);
        resolved.push(normalized);
      } else {
        const fallback = {
          fileId: String(item.fileId || ''),
          name: String(item.name || ''),
        };
        merged.push(fallback);
        unresolved.push(fallback);
      }
    }

    return {
      merged,
      resolved,
      unresolved,
    };
  }

  function updateDuplicatePreviewResolvedItems(items) {
    const selectionByName = new Map(
      (STATE.duplicatePreviewItems || []).map((item) => [
        normalizeDomName(item.name),
        STATE.duplicateSelection[item.fileId] !== false,
      ])
    );

    setDuplicatePreview(
      (items || []).map((item) => ({
        fileId: String(item.fileId),
        name: String(item.name || ''),
      }))
    );

    for (const item of STATE.duplicatePreviewItems || []) {
      const saved = selectionByName.get(normalizeDomName(item.name));
      if (typeof saved === 'boolean') {
        STATE.duplicateSelection[item.fileId] = saved;
      }
    }

    renderDuplicatePreviewList();
  }

  async function ensureDuplicateItemsHaveRealIds(previewItems, options = {}) {
    const domItems = (previewItems || []).filter((item) => String(item?.fileId || '').startsWith('dom:'));
    if (!domItems.length) {
      return {
        mergedItems: (previewItems || []).map((item) => ({
          fileId: String(item.fileId),
          name: String(item.name || ''),
        })),
        resolved: (previewItems || []).map((item) => ({
          fileId: String(item.fileId),
          name: String(item.name || ''),
        })),
        unresolved: [],
        source: 'existing',
      };
    }

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const candidateSources = [];
    const verifiedPageSize = Math.max(
      Number(UI.fields.pageSize?.value || 0),
      Number(CONFIG.request.manualListBody.pageSize || 0),
      Number(getCapturedItems().length || 0),
      Number((previewItems || []).length || 0) + 50,
      200
    );

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 8,
        indeterminate: true,
        text: '正在补齐真实 fileId...',
      });
    }

    try {
      const fetched = await fetchCurrentList({ pageSize: verifiedPageSize });
      if (fetched.length) {
        candidateSources.push({
          source: 'api',
          items: fetched,
        });
      }
    } catch (err) {
      warn('删除前补齐真实 fileId 时，接口拉取列表失败：', err);
    }

    const captured = getCapturedItems();
    if (captured.length) {
      candidateSources.push({
        source: 'captured',
        items: captured,
      });
    }

    for (const entry of candidateSources) {
      const mapping = resolveItemsByName(previewItems, entry.items);
      if (!mapping.unresolved.length) {
        return {
          mergedItems: mapping.merged,
          resolved: mapping.resolved,
          unresolved: [],
          source: entry.source,
        };
      }
    }

    const best = candidateSources.length
      ? resolveItemsByName(previewItems, candidateSources[0].items)
      : {
          merged: (previewItems || []).map((item) => ({
            fileId: String(item.fileId || ''),
            name: String(item.name || ''),
          })),
          resolved: (previewItems || []).filter((item) => !String(item?.fileId || '').startsWith('dom:')).map((item) => ({
            fileId: String(item.fileId || ''),
            name: String(item.name || ''),
          })),
          unresolved: domItems.map((item) => ({
            fileId: String(item.fileId || ''),
            name: String(item.name || ''),
          })),
        };

    return {
      mergedItems: best.merged,
      resolved: best.resolved,
      unresolved: best.unresolved,
      source: candidateSources[0]?.source || 'none',
    };
  }

  function getSelectedDuplicatePreviewItems() {
    return (STATE.duplicatePreviewItems || []).filter((item) => STATE.duplicateSelection[item.fileId] !== false);
  }

  function renderDuplicatePreviewList() {
    if (!UI.duplicateList || !UI.duplicateCount) {
      return;
    }

    const items = STATE.duplicatePreviewItems || [];
    const selected = getSelectedDuplicatePreviewItems();
    UI.duplicateCount.textContent = `删除勾选 ${selected.length}/${items.length}`;

    if (!items.length) {
      UI.duplicateList.innerHTML = '<div class="gyp-duplicate-empty">先点“重复项预览”，再在这里取消不想删的项目。</div>';
      return;
    }

    UI.duplicateList.innerHTML = items.map((item) => `
      <label class="gyp-duplicate-row">
        <input
          type="checkbox"
          data-action="toggle-duplicate"
          data-file-id="${escapeHtml(item.fileId)}"
          ${STATE.duplicateSelection[item.fileId] !== false ? 'checked' : ''}
        />
        <span class="gyp-duplicate-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      </label>
    `).join('');
  }

  function setDuplicatePreview(items, options = {}) {
    const preserveSelection = Boolean(options.preserveSelection);
    const deduped = [];
    const seen = new Set();
    for (const item of items || []) {
      if (!item || !item.fileId || seen.has(item.fileId)) {
        continue;
      }
      seen.add(item.fileId);
      deduped.push({
        fileId: String(item.fileId),
        name: String(item.name || ''),
      });
    }

    const nextSelection = {};
    for (const item of deduped) {
      if (preserveSelection && Object.prototype.hasOwnProperty.call(STATE.duplicateSelection, item.fileId)) {
        nextSelection[item.fileId] = STATE.duplicateSelection[item.fileId] !== false;
      } else {
        nextSelection[item.fileId] = true;
      }
    }

    STATE.duplicatePreviewItems = deduped;
    STATE.duplicateSelection = nextSelection;
    renderDuplicatePreviewList();
    if (UI.duplicateDetails) {
      UI.duplicateDetails.open = true;
    }
  }

  function buildCheckedPageSelectionPreviewItems(options = {}) {
    const onlyDirectories = Boolean(options.onlyDirectories);
    const entries = dedupeElements([
      ...collectVisibleListRowEntries(),
      ...collectCheckedListRowEntries(),
    ]);
    const seen = new Set();
    const out = [];

    for (const entry of entries) {
      if (!entry?.checkbox || !isElementChecked(entry.checkbox)) {
        continue;
      }
      if (onlyDirectories && !entry.isDir) {
        continue;
      }

      const normalizedName = normalizeDomName(entry.name || '');
      const key = `${entry.isDir ? 'dir' : 'file'}:${normalizedName}`;
      if (!normalizedName || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        fileId: `dom:checked:${out.length}:${entry.name}`,
        name: String(entry.name || ''),
        isDir: entry.isDir === true,
        resolved: false,
      });
    }

    return out;
  }

  function collectCheckedListRowEntries() {
    const checkboxNodes = Array.from(document.querySelectorAll(
      'input[type="checkbox"], label[role="checkbox"], [role="checkbox"], [aria-label*="选择"], button[aria-label*="选择"], [data-testid*="checkbox"], [class*="checkbox"], [class*="check"]'
    ));
    const seen = new Set();
    const out = [];

    for (const checkbox of checkboxNodes) {
      if (!checkbox || isHelperPanelNode(checkbox) || !isElementChecked(checkbox)) {
        continue;
      }

      const row = getClosestRow(checkbox);
      if (!row || !isUsableListRow(row)) {
        continue;
      }

      const name = extractNameFromRow(row);
      const normalizedName = normalizeDomName(name);
      const checkboxInRow = getCheckboxInRow(row) || checkbox;
      const key = `${guessDomRowIsDirectory(row, name) ? 'dir' : 'file'}:${normalizedName}`;
      if (!normalizedName || !isProbablyUsefulName(name) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      out.push({
        row,
        name,
        normalizedName,
        checkbox: checkboxInRow,
        isDir: guessDomRowIsDirectory(row, name),
      });
    }

    return out;
  }

  async function collectCheckedPageSelectionByScrolling(options = {}) {
    const container = options.container || findScrollableListContainer();
    const taskControl = options.taskControl || null;
    const expectedCount = Math.max(0, Number(options.expectedCount || 0));
    const maxRounds = Math.max(1, Number(options.maxRounds || 48));
    const isDocumentScroller =
      container === document.scrollingElement ||
      container === document.documentElement ||
      container === document.body;
    const startScroll = container
      ? (isDocumentScroller ? (window.scrollY || window.pageYOffset || 0) : container.scrollTop)
      : 0;
    const deltaY = Math.max(280, Math.floor((container?.clientHeight || window.innerHeight || 640) * 0.72));
    const seen = new Map();

    const addItems = (items = []) => {
      for (const item of items) {
        if (!item) {
          continue;
        }
        const key = `${item.isDir ? 'dir' : 'file'}:${normalizeDomName(item.name || '')}`;
        if (!key || seen.has(key)) {
          continue;
        }
        seen.set(key, item);
      }
    };

    try {
      if (container) {
        if (isDocumentScroller) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        } else {
          container.scrollTop = 0;
        }
        await sleep(180);
      }

      for (let round = 0; round < maxRounds; round += 1) {
        await waitForTaskControl(taskControl);
        addItems(buildCheckedPageSelectionPreviewItems({ onlyDirectories: false }));

        if (expectedCount > 0 && seen.size >= expectedCount) {
          break;
        }

        const moved = await scrollListContainer(container, deltaY);
        if (!moved) {
          break;
        }
      }
    } finally {
      if (container) {
        if (isDocumentScroller) {
          window.scrollTo({ top: startScroll, behavior: 'auto' });
        } else {
          container.scrollTop = startScroll;
        }
      }
    }

    return Array.from(seen.values());
  }

  function getPageSelectedCount() {
    const pattern = /(?:已选(?:择)?|已勾选|selected)\s*(\d+)\s*项/iu;
    let maxCount = 0;
    const nodes = Array.from(document.querySelectorAll('span, div, p, strong, b, em, button'));

    for (const node of nodes) {
      if (!node || !isVisibleElement(node) || isHelperPanelNode(node)) {
        continue;
      }
      const text = normalizeDomName(node.textContent || node.innerText || '');
      if (!text || text.length > 40) {
        continue;
      }
      const matched = text.match(pattern);
      if (!matched) {
        continue;
      }
      const count = Number(matched[1] || 0);
      if (Number.isFinite(count) && count > maxCount) {
        maxCount = count;
      }
    }

    return maxCount;
  }

  async function collectCheckedPageSelectionPreviewItems(options = {}) {
    const onlyDirectories = Boolean(options.onlyDirectories);
    const taskControl = options.taskControl || null;
    const visibleAllItems = buildCheckedPageSelectionPreviewItems({ onlyDirectories: false });
    const visibleItems = onlyDirectories ? visibleAllItems.filter((item) => item.isDir) : visibleAllItems;
    const pageSelectedCount = Math.max(0, Number(options.pageSelectedCount != null ? options.pageSelectedCount : getPageSelectedCount()) || 0);
    const currentParentId = String(getCurrentListContext().parentId || CONFIG.request.manualListBody.parentId || '').trim();
    const capturedItems = dedupeItems(getCapturedItems() || []);
    const capturedCount = capturedItems.length;
    const visibleCount = visibleAllItems.length;

    if (!pageSelectedCount || visibleCount >= pageSelectedCount) {
      return {
        items: visibleItems,
        meta: {
          expectedCount: Math.max(pageSelectedCount, visibleCount, visibleItems.length),
          visibleCount,
          partial: false,
          source: 'visible',
          warning: '',
        },
      };
    }

    const scannedAllItems = await collectCheckedPageSelectionByScrolling({
      taskControl,
      expectedCount: pageSelectedCount,
      maxRounds: Math.max(24, Math.min(96, pageSelectedCount + 18)),
    });
    const scannedAllCount = scannedAllItems.length;
    const scannedItems = onlyDirectories
      ? scannedAllItems.filter((item) => item.isDir === true)
      : scannedAllItems;

    if (scannedAllCount >= pageSelectedCount) {
      return {
        items: scannedItems,
        meta: {
          expectedCount: pageSelectedCount,
          visibleCount: scannedAllCount,
          partial: false,
          source: 'scroll-scan',
          warning: onlyDirectories
            ? `页面已选 ${pageSelectedCount} 项，已滚动扫描完整个列表；其中勾选文件夹 ${scannedItems.length} 项。`
            : `页面已选 ${pageSelectedCount} 项，已滚动扫描完整个列表并补齐全部勾选项。`,
        },
      };
    }

    if (capturedCount && capturedCount === pageSelectedCount) {
      const normalizedCapturedItems = capturedItems.map((item) => ({
        ...item,
        resolved: true,
      }));
      const matchedItems = onlyDirectories
        ? normalizedCapturedItems.filter((item) => item.isDir === true || shouldTreatItemAsDirectory(item))
        : normalizedCapturedItems;
      return {
        items: matchedItems,
        meta: {
          expectedCount: pageSelectedCount,
          visibleCount,
          partial: false,
          source: 'captured-all-current-dir',
          warning: onlyDirectories
            ? `页面已选 ${pageSelectedCount} 项，已使用脚本累计识别的当前目录列表补齐；其中可操作文件夹 ${matchedItems.length} 项。`
            : `页面已选 ${pageSelectedCount} 项，已使用脚本累计识别的当前目录列表补齐全部勾选项。`,
        },
      };
    }

    if (!currentParentId) {
      return {
        items: visibleItems,
        meta: {
          expectedCount: pageSelectedCount,
          visibleCount: Math.max(visibleCount, scannedAllCount),
          partial: true,
          source: 'scroll-partial',
          warning: `页面显示已选 ${pageSelectedCount} 项，脚本已尝试滚动扫描整页，但目前只识别到 ${Math.max(visibleCount, scannedAllCount)} 项；还没拿到当前目录 parentId，暂时无法继续补齐。`,
        },
      };
    }

    const verifiedPageSize = Math.max(
      Number(UI.fields.pageSize?.value || 0),
      Number(CONFIG.request.manualListBody.pageSize || 0),
      Number(getCurrentListContext().capturedCount || 0),
      pageSelectedCount,
      200
    );

    try {
      const listing = await fetchDirectoryItemsByParentId(currentParentId, {
        pageSize: verifiedPageSize,
        maxPages: Math.max(2, Math.ceil(pageSelectedCount / Math.max(1, verifiedPageSize)) + 2),
        delayMs: 0,
        taskControl,
      });
      const fullItems = dedupeItems(listing.items || []);

      if (!listing.truncated && fullItems.length === pageSelectedCount) {
        const normalizedFullItems = fullItems.map((item) => ({
          ...item,
          resolved: true,
        }));
        return {
          items: onlyDirectories
            ? normalizedFullItems.filter((item) => item.isDir === true || shouldTreatItemAsDirectory(item))
            : normalizedFullItems,
          meta: {
            expectedCount: pageSelectedCount,
            visibleCount,
            partial: false,
            source: 'all-current-dir',
            warning: onlyDirectories
              ? `页面已选 ${pageSelectedCount} 项，已按“当前目录全选”补齐；其中可操作文件夹 ${normalizedFullItems.filter((item) => item.isDir === true || shouldTreatItemAsDirectory(item)).length} 项。`
              : `页面已选 ${pageSelectedCount} 项，已按“当前目录全选”自动补齐全部勾选项。`,
          },
        };
      }

      return {
        items: scannedItems.length > visibleItems.length ? scannedItems : visibleItems,
        meta: {
          expectedCount: pageSelectedCount,
          visibleCount: Math.max(visibleCount, scannedAllCount),
          partial: true,
          source: 'scroll-partial',
          warning: `页面显示已选 ${pageSelectedCount} 项，脚本已尝试滚动扫描整页，但目前只识别到 ${Math.max(visibleCount, scannedAllCount)} 项。请稍等列表继续加载，或上下滚动一次后再试。`,
        },
      };
    } catch (err) {
      return {
        items: scannedItems.length > visibleItems.length ? scannedItems : visibleItems,
        meta: {
          expectedCount: pageSelectedCount,
          visibleCount: Math.max(visibleCount, scannedAllCount),
          partial: true,
          source: 'scroll-partial',
          warning: `页面显示已选 ${pageSelectedCount} 项，滚动扫描后识别到 ${Math.max(visibleCount, scannedAllCount)} 项；继续补齐失败：${getErrorText(err) || '未知错误'}。`,
        },
      };
    }
  }

  function renderMoveSelectionList() {
    if (!UI.moveSelectionList || !UI.moveSelectionCount) {
      return;
    }

    const items = Array.isArray(STATE.moveSelectionPreviewItems) ? STATE.moveSelectionPreviewItems : [];
    const expectedCount = Math.max(0, Number(STATE.moveSelectionExpectedCount || 0));
    const warning = String(STATE.moveSelectionWarning || '').trim();
    UI.moveSelectionCount.textContent =
      expectedCount > items.length
        ? `当前勾选 ${items.length}/${expectedCount} 项`
        : `当前勾选 ${Math.max(items.length, expectedCount)} 项`;

    if (!items.length) {
      UI.moveSelectionList.innerHTML = `
        ${warning ? `<div class="gyp-import-empty">${escapeHtml(warning)}</div>` : ''}
        <div class="gyp-import-empty">点“读取当前勾选”后，这里会显示当前页面已勾选的文件 / 文件夹。</div>
      `;
      return;
    }

    UI.moveSelectionList.innerHTML = `
      ${warning ? `<div class="gyp-import-empty">${escapeHtml(warning)}</div>` : ''}
      ${items.map((item) => `
      <div class="gyp-import-row">
        <div class="gyp-import-name" title="${escapeHtml(String(item.name || ''))}">${escapeHtml(String(item.name || ''))}</div>
        <div class="gyp-import-meta">${item.isDir ? '文件夹' : '文件'} | ${item.resolved ? `已识别 fileId: ${escapeHtml(String(item.fileId || ''))}` : '仅识别到当前页面勾选，执行前会自动补齐真实 fileId'}</div>
      </div>
      `).join('')}
    `;
  }

  function setMoveSelectionPreview(items = [], meta = {}) {
    STATE.moveSelectionPreviewItems = (items || []).filter(Boolean).map((item) => ({
      fileId: String(item.fileId || ''),
      name: String(item.name || ''),
      isDir: item.isDir === true,
      resolved: Boolean(item.resolved || (item.fileId && !String(item.fileId).startsWith('dom:'))),
      parentId: String(item.parentId || ''),
      dirId: String(item.dirId || item.fileId || ''),
      dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
    }));
    STATE.moveSelectionExpectedCount = Math.max(0, Number(meta.expectedCount || 0));
    STATE.moveSelectionSource = String(meta.source || 'visible');
    STATE.moveSelectionWarning = String(meta.warning || '');
    renderMoveSelectionList();
    if (UI.moveDetails) {
      UI.moveDetails.open = true;
    }
  }

  function resolveCheckedMoveItemsByName(previewItems, sourceItems) {
    const exactMap = new Map();

    for (const item of sourceItems || []) {
      if (!item || !item.fileId || String(item.fileId).startsWith('dom:')) {
        continue;
      }
      const key = normalizeDomName(item.name);
      if (!key) {
        continue;
      }
      if (!exactMap.has(key)) {
        exactMap.set(key, []);
      }
      exactMap.get(key).push(item);
    }

    const merged = [];
    const resolved = [];
    const unresolved = [];

    for (const item of previewItems || []) {
      if (!item) {
        continue;
      }

      if (item.fileId && !String(item.fileId).startsWith('dom:')) {
        const normalized = {
          fileId: String(item.fileId),
          dirId: String(item.dirId || item.fileId),
          dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
          name: String(item.name || ''),
          parentId: String(item.parentId || ''),
          isDir: item.isDir === true,
          raw: item.raw,
          resolved: true,
        };
        merged.push(normalized);
        resolved.push(normalized);
        continue;
      }

      const key = normalizeDomName(item.name);
      const matches = key ? (exactMap.get(key) || []) : [];
      const typeMatched = matches.filter((candidate) => {
        const candidateIsDir = candidate.isDir === true || shouldTreatItemAsDirectory(candidate);
        return candidateIsDir === (item.isDir === true);
      });
      const chosen = typeMatched.length === 1 ? typeMatched[0] : (matches.length === 1 ? matches[0] : null);

      if (chosen) {
        const normalized = {
          fileId: String(chosen.fileId),
          dirId: String(chosen.dirId || chosen.fileId),
          dirIdCandidates: normalizeIdCandidates(chosen.dirIdCandidates || [chosen.dirId, chosen.fileId]),
          name: String(chosen.name || item.name || ''),
          parentId: String(chosen.parentId || ''),
          isDir: chosen.isDir === true || shouldTreatItemAsDirectory(chosen),
          raw: chosen.raw,
          resolved: true,
        };
        merged.push(normalized);
        resolved.push(normalized);
      } else {
        const fallback = {
          fileId: String(item.fileId || ''),
          dirId: String(item.dirId || item.fileId || ''),
          dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
          name: String(item.name || ''),
          parentId: String(item.parentId || ''),
          isDir: item.isDir === true,
          raw: item.raw,
          resolved: false,
        };
        merged.push(fallback);
        unresolved.push(fallback);
      }
    }

    return {
      merged,
      resolved,
      unresolved,
    };
  }

  async function ensureCheckedMoveItemsHaveRealIds(previewItems, options = {}) {
    const domItems = (previewItems || []).filter((item) => String(item?.fileId || '').startsWith('dom:'));
    if (!domItems.length) {
      return {
        mergedItems: (previewItems || []).map((item) => ({
          ...item,
          fileId: String(item.fileId || ''),
          dirId: String(item.dirId || item.fileId || ''),
          dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
          name: String(item.name || ''),
          parentId: String(item.parentId || ''),
          isDir: item.isDir === true,
          resolved: true,
        })),
        resolved: (previewItems || []).map((item) => ({
          ...item,
          fileId: String(item.fileId || ''),
          dirId: String(item.dirId || item.fileId || ''),
          dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
          name: String(item.name || ''),
          parentId: String(item.parentId || ''),
          isDir: item.isDir === true,
          resolved: true,
        })),
        unresolved: [],
        source: 'existing',
      };
    }

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const context = getCurrentListContext();
    const candidateSources = [];
    const verifiedPageSize = Math.max(
      Number(UI.fields.pageSize?.value || 0),
      Number(CONFIG.request.manualListBody.pageSize || 0),
      Number(getCapturedItems().length || 0),
      Number((previewItems || []).length || 0) + 50,
      200
    );

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 8,
        indeterminate: true,
        text: '正在补齐当前勾选项的真实 fileId...',
      });
    }

    try {
      const fetched = await fetchCurrentList({ pageSize: verifiedPageSize });
      if (fetched.length) {
        candidateSources.push({
          source: 'api',
          items: fetched,
        });
      }
    } catch (err) {
      warn('移动前补齐真实 fileId 时，接口拉取列表失败：', err);
    }

    const captured = getCapturedItems();
    if (captured.length) {
      candidateSources.push({
        source: 'captured',
        items: captured,
      });
    }

    const snapshotItems = buildCurrentDirectoryItemsSnapshot(context.parentId);
    if (snapshotItems.length) {
      candidateSources.push({
        source: 'snapshot',
        items: snapshotItems,
      });
    }

    for (const entry of candidateSources) {
      const mapping = resolveCheckedMoveItemsByName(previewItems, entry.items);
      if (!mapping.unresolved.length) {
        return {
          mergedItems: mapping.merged,
          resolved: mapping.resolved,
          unresolved: [],
          source: entry.source,
        };
      }
    }

    const best = candidateSources.length
      ? resolveCheckedMoveItemsByName(previewItems, candidateSources[0].items)
      : {
          merged: (previewItems || []).map((item) => ({
            ...item,
            fileId: String(item.fileId || ''),
            dirId: String(item.dirId || item.fileId || ''),
            dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
            name: String(item.name || ''),
            parentId: String(item.parentId || ''),
            isDir: item.isDir === true,
            resolved: false,
          })),
          resolved: [],
          unresolved: domItems.map((item) => ({
            ...item,
            fileId: String(item.fileId || ''),
            dirId: String(item.dirId || item.fileId || ''),
            dirIdCandidates: normalizeIdCandidates(item.dirIdCandidates || [item.dirId, item.fileId]),
            name: String(item.name || ''),
            parentId: String(item.parentId || ''),
            isDir: item.isDir === true,
            resolved: false,
          })),
        };

    return {
      mergedItems: best.merged,
      resolved: best.resolved,
      unresolved: best.unresolved,
      source: candidateSources[0]?.source || 'none',
    };
  }

  async function collectResolvedCheckedMoveItems(options = {}) {
    const selection = await collectCheckedPageSelectionPreviewItems({
      onlyDirectories: Boolean(options.onlyDirectories),
      taskControl: options.taskControl || null,
    });
    const previewItems = selection.items || [];
    setMoveSelectionPreview(previewItems, selection.meta);

    if (!previewItems.length) {
      throw new Error(options.onlyDirectories ? '当前页面没有勾选任何文件夹。' : '当前页面没有勾选任何文件或文件夹。');
    }

    if (selection.meta?.partial) {
      throw new Error(
        selection.meta.warning
        || `页面显示已选 ${selection.meta?.expectedCount || 0} 项，但当前只能识别到 ${selection.meta?.visibleCount || previewItems.length} 项。`
      );
    }

    const ensured = await ensureCheckedMoveItemsHaveRealIds(previewItems, {
      onProgress: options.onProgress,
    });
    setMoveSelectionPreview(ensured.mergedItems, selection.meta);

    if (ensured.unresolved.length) {
      const sample = ensured.unresolved.slice(0, 6).map((item) => item.name).filter(Boolean).join('、');
      throw new Error(
        `当前有 ${ensured.unresolved.length} 个勾选项没拿到真实 fileId。请先等待当前目录列表加载完整，或刷新页面后再试。${sample ? ` 未识别示例：${sample}` : ''}`
      );
    }

    return ensured.resolved;
  }

  async function moveFilesInBatches(fileIds, parentId, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const batchSize = Math.max(1, Number(options.batchSize || CONFIG.move.batchSize || 100));
    const label = String(options.label || '移动项目');
    const allowSplitRetry = options.allowSplitRetry !== false;
    const verifySourceItems = Array.isArray(options.verifySourceItems) ? options.verifySourceItems.filter(Boolean) : [];
    const uniqueIds = Array.from(new Set((fileIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    const batches = chunkArray(uniqueIds, batchSize);
    const summary = {
      ok: 0,
      fail: 0,
      submittedBatches: 0,
      taskIds: [],
      movedFileIds: [],
      firstError: '',
    };

    for (let index = 0; index < batches.length; index += 1) {
      await waitForTaskControl(taskControl);
      const batch = batches[index];
      const batchSourceItems = verifySourceItems.filter((item) => batch.includes(String(item?.fileId || '')));
      if (onProgress) {
        onProgress({
          visible: true,
          percent: Math.round((index / Math.max(1, batches.length)) * 100),
          indeterminate: true,
          text: `${label}：正在提交第 ${index + 1}/${batches.length} 批，共 ${batch.length} 项`,
        });
      }

      try {
        const moveRes = await moveFiles(batch, parentId);
        if (!moveRes.ok || !isProbablySuccess(moveRes.payload, moveRes)) {
          throw new Error(getErrorText(moveRes.payload || moveRes.text || `HTTP ${moveRes.status}`));
        }

        summary.submittedBatches += 1;
        const taskId = extractTaskId(moveRes.payload);
        if (!taskId) {
          summary.ok += batch.length;
          summary.movedFileIds.push(...batch);
          continue;
        }

        summary.taskIds.push(taskId);
        if (onProgress) {
          onProgress({
            visible: true,
            percent: Math.max(10, Math.round((index / Math.max(1, batches.length)) * 100)),
            indeterminate: true,
            text: `${label}：第 ${index + 1}/${batches.length} 批已提交，taskId: ${taskId}`,
          });
        }

        const task = await waitTaskUntilDone(taskId, {
          onProgress,
          taskControl,
          expectedTotal: batch.length,
          maxTries: batchSourceItems.length ? Math.min(Math.max(CONFIG.batch.taskPollMaxTries || 12, 12), 24) : Math.max(CONFIG.batch.taskPollMaxTries || 180, 180),
          intervalMs: Math.max(CONFIG.batch.taskPollMs || 1500, 1500),
        });
        if (batchSourceItems.length && (!task.ok || !hasUsefulTaskState(task.result?.payload, batch.length))) {
          const verification = await verifyMovedItemsByList(batchSourceItems, {
            onProgress,
            taskControl,
            maxRounds: 6,
            intervalMs: Math.max(CONFIG.batch.taskPollMs || 1500, 1500),
          });
          if (verification.movedItems.length) {
            summary.ok += verification.movedItems.length;
            summary.fail += verification.remaining.length;
            summary.movedFileIds.push(...verification.movedItems.map((item) => String(item.fileId || '')).filter(Boolean));
            if (verification.ok) {
              continue;
            }
          }
          if (!verification.movedItems.length && allowSplitRetry && batch.length > 1) {
            const nextBatchSize = batch.length > 20 ? 20 : 1;
            if (nextBatchSize < batch.length) {
              if (onProgress) {
                onProgress({
                  visible: true,
                  percent: Math.max(15, Math.round((index / Math.max(1, batches.length)) * 100)),
                  indeterminate: true,
                  text: `${label}：当前整批未实际移走，正在按更小批次重试（${batch.length} -> ${nextBatchSize}）`,
                });
              }
              const retried = await moveFilesInBatches(batch, parentId, {
                onProgress,
                taskControl,
                label: `${label}小批重试`,
                batchSize: nextBatchSize,
                verifySourceItems: batchSourceItems,
                allowSplitRetry: nextBatchSize > 1,
              });
              summary.ok += retried.ok;
              summary.fail += retried.fail;
              summary.submittedBatches += retried.submittedBatches;
              summary.taskIds.push(...(retried.taskIds || []));
              summary.movedFileIds.push(...(retried.movedFileIds || []));
              if (!summary.firstError && retried.firstError) {
                summary.firstError = retried.firstError;
              }
              continue;
            }
          }
        }

        if (!task.ok) {
          const payload = task.result?.payload || task.result?.text || {};
          throw new Error(
            task.timeout
              ? `${label}任务超时，taskId: ${taskId}`
              : `${label}任务失败，taskId: ${taskId}，${getErrorText(payload) || '未返回更多信息'}`
          );
        }

        const taskCounts = extractTaskCounts(task.result?.payload, batch.length);
        const okCount = taskCounts.hasSuccessCount ? taskCounts.success : batch.length;
        const failCount = taskCounts.hasFailedCount ? taskCounts.failed : 0;
        summary.ok += okCount;
        summary.fail += failCount;
        if (failCount === 0) {
          summary.movedFileIds.push(...batch);
        }
      } catch (err) {
        summary.fail += batch.length;
        summary.firstError = summary.firstError || getErrorText(err);
        warn(`${label}失败：`, err);
        if (CONFIG.batch.stopOnError) {
          break;
        }
      }
    }

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 100,
        indeterminate: false,
        text: `${label}完成：成功 ${summary.ok} 项，失败 ${summary.fail} 项`,
      });
    }

    return summary;
  }

  async function moveCheckedFolderContentsToCurrentDirectory(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const currentParentId = String(getCurrentListContext().parentId || CONFIG.request.manualListBody.parentId || '').trim();
    if (!currentParentId) {
      throw new Error('没有拿到当前目录 parentId。请先打开目标上层目录，或在高级兜底里手填 parentId。');
    }

    const folders = await collectResolvedCheckedMoveItems({
      onlyDirectories: true,
      onProgress,
    });
    const sourceFolders = folders.filter((item) => item.isDir);
    if (!sourceFolders.length) {
      throw new Error('当前页面没有勾选任何可识别的文件夹。');
    }

    const childItems = [];
    const childSeen = new Set();
    let truncatedFolderCount = 0;
    for (let index = 0; index < sourceFolders.length; index += 1) {
      const folder = sourceFolders[index];
      await waitForTaskControl(taskControl);
      if (onProgress) {
        onProgress({
          visible: true,
          percent: Math.min(45, Math.round(((index + 1) / Math.max(1, sourceFolders.length)) * 45)),
          indeterminate: true,
          text: `正在读取文件夹内容 ${index + 1}/${sourceFolders.length}：${shortDisplayName(folder.name, 36)}`,
        });
      }

      const listing = await fetchDirectoryItems(folder.fileId, {
        idCandidates: normalizeIdCandidates([folder.fileId, folder.dirId, ...(folder.dirIdCandidates || [])]),
        taskControl,
      });
      if (listing.truncated) {
        truncatedFolderCount += 1;
      }

      for (const child of listing.items || []) {
        const key = String(child?.fileId || '').trim();
        if (!key || childSeen.has(key)) {
          continue;
        }
        childSeen.add(key);
        childItems.push({
          ...child,
          parentId: currentParentId,
        });
      }
    }

    if (!childItems.length) {
      throw new Error('勾选的文件夹里没有可移动的内容。空文件夹不会自动删除。');
    }

    if (CONFIG.batch.confirmBeforeRun && !window.confirm(`准备拆开 ${sourceFolders.length} 个已勾选文件夹，把里面的 ${childItems.length} 项直接内容移动到当前目录。这个操作不会保留外层文件夹，是否继续？`)) {
      return { ok: 0, fail: 0, movedItems: [], folders: sourceFolders, truncatedFolderCount };
    }

    const result = await moveFilesInBatches(
      childItems.map((item) => item.fileId),
      currentParentId,
      {
        onProgress,
        taskControl,
        label: '文件夹内容提到上一层',
      }
    );

    if (result.fail === 0 && childItems.length) {
      mergeCapturedItems(currentParentId, childItems, { countAsBatch: false });
    }

    return {
      ...result,
      movedItems: childItems,
      folders: sourceFolders,
      truncatedFolderCount,
    };
  }

  async function moveCheckedItemsUpOneLevel(options = {}) {
    const targetParentId = String(options.parentId || getCurrentDirectoryParentIdFromHash(location.hash)).trim();
    if (!targetParentId) {
      throw new Error('没识别出“当前目录的上一层 parentId”。请改用“勾选项移到目标目录”，手动填目标目录 parentId。');
    }

    return moveCheckedItemsToTargetDirectory({
      ...options,
      parentId: targetParentId,
    });
  }

  async function moveCheckedItemsToTargetDirectory(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const currentParentId = String(getCurrentListContext().parentId || CONFIG.request.manualListBody.parentId || '').trim();
    const targetParentId = String(options.parentId != null ? options.parentId : (UI.fields.moveTargetParentId?.value || CONFIG.move.targetParentId || '')).trim();

    if (!targetParentId) {
      throw new Error('请先填写目标目录 parentId。');
    }
    if (currentParentId && targetParentId === currentParentId) {
      throw new Error('目标目录就是当前目录，当前勾选项已经在这里了。');
    }

    const checkedItems = await collectResolvedCheckedMoveItems({
      onlyDirectories: false,
      onProgress,
    });
    if (!checkedItems.length) {
      throw new Error('当前页面没有勾选任何可移动的文件或文件夹。');
    }

    if (CONFIG.batch.confirmBeforeRun && !window.confirm(`准备把当前页面已勾选的 ${checkedItems.length} 项移动到目录 ${targetParentId}，是否继续？`)) {
      return { ok: 0, fail: 0, movedItems: checkedItems, targetParentId };
    }

    const result = await moveFilesInBatches(
      checkedItems.map((item) => item.fileId),
      targetParentId,
      {
        onProgress,
        taskControl,
        label: '移动勾选项到目标目录',
        verifySourceItems: checkedItems,
      }
    );

    if ((result.movedFileIds || []).length) {
      removeCapturedItemsByIds(result.movedFileIds);
    } else if (result.fail === 0 && checkedItems.length) {
      removeCapturedItemsByIds(checkedItems.map((item) => item.fileId));
    }

    return {
      ...result,
      movedItems: checkedItems,
      targetParentId,
    };
  }

  async function run(options = {}) {
    const targets = await preview(options);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;

    if (!targets.length) {
      warn('没有需要改名的项目。');
      return { ok: 0, fail: 0, targets };
    }

    if (targets.some((item) => String(item.fileId || '').startsWith('dom:'))) {
      throw new Error('当前只拿到了页面名称，请刷新页面等待脚本捕获真实列表后再试。');
    }

    if (CONFIG.batch.confirmBeforeRun && !window.confirm(`准备重命名 ${targets.length} 个项目，是否继续？`)) {
      return { ok: 0, fail: 0, targets };
    }

    let ok = 0;
    let failed = 0;
    let index = 0;
    let firstError = '';

    for (const target of targets) {
      await waitForTaskControl(taskControl);
      index += 1;
      let currentTarget = { ...target };
      let success = false;
      let attempt = 0;
      let lastRes = null;

      // 自动重试逻辑：如果重名，尝试 (1), (2), (3)
      while (attempt <= 3 && !success) {
        await waitForTaskControl(taskControl);
        if (onProgress) {
          onProgress({
            visible: true,
            percent: ((index - 1) / targets.length) * 100,
            text: `进度 ${index}/${targets.length} | 成功 ${ok} | 失败 ${failed}\n当前：${shortDisplayName(currentTarget.oldName)} -> ${shortDisplayName(currentTarget.newName)}`,
          });
        }

        try {
          lastRes = await renameOne(currentTarget);
          if (lastRes.ok) {
            success = true;
            ok += 1;
            renameCapturedItem(target.fileId, currentTarget.newName);
            console.log(LOG_PREFIX, `成功：${currentTarget.oldName} -> ${currentTarget.newName}`);
          } else if (lastRes.payload && lastRes.payload.code === 160) {
            // 【核心逻辑】如果服务器报 160 (已存在)，自动加后缀重试
            attempt++;
            const base = getBaseName(target.newName);
            const ext = getExt(target.newName);
            currentTarget.newName = `${base}(${attempt})${ext}`;
            console.warn(LOG_PREFIX, `重名冲突，自动尝试第 ${attempt} 次重试: ${currentTarget.newName}`);
          } else {
            break; // 其他错误（如 token 失效），跳出重试
          }
        } catch (err) {
          break;
        }
      }

      if (!success) {
        failed += 1;
        const errMsg = lastRes?.payload?.msg || lastRes?.text || '未知错误';
        firstError = firstError || errMsg;
        fail(`最终失败 [${target.oldName}] -> 尝试改名为 [${currentTarget.newName}]`, errMsg);
        if (CONFIG.batch.stopOnError) break;
      }

      if (CONFIG.batch.delayMs > 0) await controlledDelay(CONFIG.batch.delayMs, taskControl);
    }

    if (onProgress) {
      onProgress({ visible: true, percent: 100, text: `执行完成！成功 ${ok}，失败 ${failed}` });
    }
    return { ok, fail: failed, firstError };
  }

  function exportState() {
    const visibleHeaders = { ...getMergedHeaders() };
    if (visibleHeaders.authorization) {
      visibleHeaders.authorization = 'Bearer ***';
    }

    return {
      installedAt: STATE.installedAt,
      headers: visibleHeaders,
      lastListUrl: STATE.lastListUrl,
      lastListBody: STATE.lastListBody,
      lastItemsSource: STATE.lastItemsSource,
      lastRenameUrl: STATE.lastRenameRequest?.url || '',
      lastRenameBody: STATE.lastRenameRequest?.requestBody || null,
      capturedItemCount: getCapturedItems().length,
      magnetImportFiles: (STATE.magnetImportFiles || []).map((item) => ({
        name: item.name,
        magnetCount: item.magnetCount || item.magnets?.length || 0,
      })),
      lastCloudImportSummary: STATE.lastCloudImportSummary,
      lastCloudTaskCount: extractCloudTaskRows(STATE.lastCloudTaskList).length,
      moveSelectionPreviewCount: Array.isArray(STATE.moveSelectionPreviewItems) ? STATE.moveSelectionPreviewItems.length : 0,
      moveSelectionExpectedCount: Number(STATE.moveSelectionExpectedCount || 0),
      moveSelectionSource: STATE.moveSelectionSource || 'visible',
      moveSelectionWarning: STATE.moveSelectionWarning || '',
      lastEmptyDirScan: STATE.lastEmptyDirScan
        ? {
            rootParentId: STATE.lastEmptyDirScan.rootParentId,
            scannedDirs: STATE.lastEmptyDirScan.scannedDirs,
            scannedItems: STATE.lastEmptyDirScan.scannedItems,
            emptyDirCount: STATE.lastEmptyDirScan.emptyDirs?.length || 0,
            truncated: Boolean(STATE.lastEmptyDirScan.truncated),
          }
        : null,
      sampleItems: getCapturedItems().slice(0, 5),
    };
  }

  function isElementChecked(node) {
    if (!node) {
      return false;
    }

    if (node instanceof HTMLInputElement && node.type === 'checkbox') {
      return Boolean(node.checked);
    }

    const ariaChecked = node.getAttribute && node.getAttribute('aria-checked');
    if (ariaChecked === 'true') {
      return true;
    }

    const className = String(node.className || '').toLowerCase();
    return className.includes('checked') || className.includes('selected') || className.includes('is-checked');
  }

  function isVisibleElement(node) {
    return Boolean(node && typeof node.getClientRects === 'function' && node.getClientRects().length > 0);
  }

  function dedupeElements(nodes) {
    const out = [];
    const seen = new Set();
    for (const node of nodes || []) {
      if (!node || seen.has(node)) {
        continue;
      }
      seen.add(node);
      out.push(node);
    }
    return out;
  }

  function getRowSelector() {
    return [
      '[role="row"]',
      'tr',
      'li',
      '[class*="row"]',
      '[class*="item"]',
      '[class*="file"]',
      '[class*="entry"]',
      '[class*="list-item"]',
      '[data-row-key]',
      '[data-id]',
    ].join(', ');
  }

  function getClosestRow(node) {
    if (!node || typeof node.closest !== 'function') {
      return null;
    }
    return node.closest(getRowSelector());
  }

  function buildExpectedNameTokens(name) {
    const normalized = normalizeDomName(name);
    if (!normalized) {
      return [];
    }

    const stem = normalized.replace(/\.[a-z0-9]{1,12}$/i, '');
    const tokens = [
      normalized,
      stem,
      stem.slice(0, 18),
      stem.slice(0, 28),
    ].map((x) => normalizeDomName(x)).filter((x) => x && x.length >= 8);

    return Array.from(new Set(tokens)).sort((a, b) => b.length - a.length);
  }

  function textLooksLikeExpected(text, expectedName) {
    const normalizedText = normalizeDomName(text);
    const normalizedExpected = normalizeDomName(expectedName);
    if (!normalizedText || !normalizedExpected) {
      return false;
    }
    if (normalizedText === normalizedExpected) {
      return true;
    }
    if (normalizedText.includes(normalizedExpected) || normalizedExpected.includes(normalizedText)) {
      return true;
    }

    const tokens = buildExpectedNameTokens(normalizedExpected);
    return tokens.some((token) => normalizedText.includes(token));
  }

  function getCheckboxInRow(row) {
    if (!row) {
      return null;
    }

    const selectors = [
      'label[role="checkbox"]',
      '[role="checkbox"]',
      '[aria-label*="选择"]',
      'button[aria-label*="选择"]',
      '[data-testid*="checkbox"]',
      '[class*="checkbox"]',
      '[class*="check"]',
      'input[type="checkbox"]',
    ];

    const searchRoots = dedupeElements([
      row,
      row.parentElement,
      row.previousElementSibling,
      row.nextElementSibling,
      row.firstElementChild,
      row.lastElementChild,
    ]);

    for (const root of searchRoots) {
      if (!root) {
        continue;
      }
      for (const selector of selectors) {
        const nodes = [];
        if (root.matches && root.matches(selector)) {
          nodes.push(root);
        }
        if (root.querySelectorAll) {
          nodes.push(...root.querySelectorAll(selector));
        }

        for (const node of nodes) {
          let current = node;
          while (current && current !== document.body) {
            if (isVisibleElement(current)) {
              return current;
            }
            if (current === row || current === root) {
              break;
            }
            current = current.parentElement;
          }
        }
      }
    }

    return null;
  }

  function getListRows() {
    return dedupeElements(Array.from(document.querySelectorAll(getRowSelector())).filter((node) => isUsableListRow(node)));
  }

  function findScrollableListContainer() {
    const rows = getListRows().filter(isVisibleElement).slice(0, 12);
    const scored = [];

    for (const row of rows) {
      let current = row.parentElement;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const overflowY = style ? style.overflowY : '';
        const canScroll =
          current.scrollHeight > current.clientHeight + 40 &&
          /(auto|scroll|overlay)/i.test(String(overflowY || ''));
        if (canScroll) {
          scored.push({
            node: current,
            score: current.scrollHeight - current.clientHeight,
          });
        }
        current = current.parentElement;
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.node || document.scrollingElement || document.documentElement;
  }

  async function scrollListContainer(container, deltaY) {
    if (!container) {
      return false;
    }

    const isDocumentScroller =
      container === document.scrollingElement ||
      container === document.documentElement ||
      container === document.body;

    const before = isDocumentScroller ? (window.scrollY || window.pageYOffset || 0) : container.scrollTop;
    if (isDocumentScroller) {
      window.scrollTo({ top: Math.max(0, before + deltaY), behavior: 'auto' });
    } else {
      container.scrollTop = Math.max(0, before + deltaY);
    }
    await sleep(220);
    const after = isDocumentScroller ? (window.scrollY || window.pageYOffset || 0) : container.scrollTop;
    return after !== before;
  }

  function isCheckboxLikeNode(node) {
    if (!node || typeof node.closest !== 'function') {
      return false;
    }
    return Boolean(node.closest(
      'label[role="checkbox"], [role="checkbox"], [aria-label*="选择"], button[aria-label*="选择"], [data-testid*="checkbox"], [class*="checkbox"], [class*="check"], input[type="checkbox"]'
    ));
  }

  function collectVisibleListRowEntries(expectedNames = []) {
    const expectedSet = new Set((expectedNames || []).map((name) => normalizeDomName(name)).filter(Boolean));
    const seen = new Set();

    return getListRows()
      .filter((row) => isUsableListRow(row))
      .map((row, index) => {
        const matchedName = expectedSet.size ? findExpectedNameInRow(row, expectedSet) : '';
        const name = matchedName || extractNameFromRow(row);
        const normalizedName = normalizeDomName(name);
        if (!isProbablyUsefulName(name) || !normalizedName || seen.has(normalizedName)) {
          return null;
        }
        seen.add(normalizedName);
        return {
          index,
          row,
          name,
          normalizedName,
          checkbox: getCheckboxInRow(row),
          isDir: guessDomRowIsDirectory(row, name),
        };
      })
      .filter(Boolean);
  }

  function collectVisibleDirectoryRows(expectedNames = []) {
    return collectVisibleListRowEntries(expectedNames).filter((item) => item.isDir);
  }

  function buildEmptyScanChildDirs(items = [], visibleRows = []) {
    const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const visibleDirs = (Array.isArray(visibleRows) ? visibleRows : [])
      .filter((item) => item && item.isDir && String(item.name || '').trim());
    const visibleByName = new Map();

    for (const item of visibleDirs) {
      const key = normalizeDomName(item.name);
      if (key && !visibleByName.has(key)) {
        visibleByName.set(key, item);
      }
    }

    const merged = [];
    const seenKeys = new Set();
    const pushMerged = (item) => {
      if (!item) {
        return;
      }
      const key = String(item.fileId || normalizeDomName(item.name) || '').trim();
      if (!key || seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      merged.push(item);
    };

    for (const item of normalizedItems) {
      const nameKey = normalizeDomName(item?.name || '');
      const visibleMatch = nameKey ? visibleByName.get(nameKey) : null;
      if (!visibleMatch && !shouldTreatItemAsDirectory(item)) {
        continue;
      }

      pushMerged({
        ...item,
        isDir: true,
        dirIdCandidates: normalizeIdCandidates(item?.dirIdCandidates || [item?.dirId, item?.fileId]),
        raw: {
          ...(item?.raw || {}),
          domIsDir: Boolean(visibleMatch || item?.raw?.domIsDir),
        },
      });

      if (visibleMatch && nameKey) {
        visibleByName.delete(nameKey);
      }
    }

    for (const visible of visibleByName.values()) {
      const syntheticId = `domdir:${normalizeDomName(visible.name)}`;
      pushMerged({
        fileId: syntheticId,
        dirId: syntheticId,
        dirIdCandidates: [syntheticId],
        name: String(visible.name || ''),
        isDir: true,
        raw: {
          fromDom: true,
          domIsDir: true,
        },
      });
    }

    return merged;
  }

  function scoreDirectoryOpenTarget(node, row, expectedName = '') {
    if (!node || !isVisibleElement(node) || isHelperPanelNode(node) || isCheckboxLikeNode(node)) {
      return Number.NEGATIVE_INFINITY;
    }

    let score = node === row ? 5 : 0;
    if (node.matches && node.matches('a, [role="link"]')) {
      score += 80;
    }
    if (node.matches && node.matches('button')) {
      score += 30;
    }
    if (node.matches && node.matches('[data-name], [data-filename], [title], [aria-label], [class*="name"], [class*="title"]')) {
      score += 45;
    }

    const expected = normalizeDomName(expectedName);
    if (expected) {
      const candidates = collectTextCandidates(node);
      const matched = candidates.find((text) => textLooksLikeExpected(text, expected));
      if (matched) {
        score += 140 - Math.min(40, Math.abs(normalizeDomName(matched).length - expected.length));
      }
    }

    return score;
  }

  function getDirectoryOpenTarget(row, expectedName = '') {
    if (!row) {
      return null;
    }

    const candidates = dedupeElements([
      row,
      ...Array.from(row.querySelectorAll('a, button, [role="link"], [data-name], [data-filename], [title], [aria-label], [class*="name"], [class*="title"], span, div, p, strong, td')),
    ]).filter((node) => !isHelperPanelNode(node) && !isBreadcrumbContainerNode(node));

    candidates.sort((left, right) => scoreDirectoryOpenTarget(right, row, expectedName) - scoreDirectoryOpenTarget(left, row, expectedName));
    return candidates[0] || row;
  }

  async function locateDirectoryRowByName(expectedName, options = {}) {
    const expected = normalizeDomName(expectedName);
    if (!expected) {
      return null;
    }

    const container = options.container || findScrollableListContainer();
    const maxRounds = Math.max(1, Number(options.maxRounds || 20));
    const deltaY = Math.max(280, Math.floor((container?.clientHeight || window.innerHeight || 640) * 0.72));

    if (container && options.resetScroll !== false) {
      const isDocumentScroller =
        container === document.scrollingElement ||
        container === document.documentElement ||
        container === document.body;
      if (isDocumentScroller) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        container.scrollTop = 0;
      }
      await sleep(180);
    }

    for (let round = 0; round < maxRounds; round += 1) {
      const visibleRows = collectVisibleDirectoryRows([expected]);
      const exact = visibleRows.find((item) => item.normalizedName === expected);
      if (exact) {
        return exact;
      }
      if (visibleRows.length) {
        return visibleRows[0];
      }

      const searchedRows = collectRowsByDocumentSearch([expected])
        .filter((item) => item.row && isUsableListRow(item.row) && guessDomRowIsDirectory(item.row, item.name || expected));
      if (searchedRows.length) {
        return searchedRows[0];
      }

      if (round >= maxRounds - 1) {
        break;
      }

      const moved = await scrollListContainer(container, deltaY);
      if (!moved) {
        break;
      }
    }

    return null;
  }

  function triggerSyntheticDblClick(target) {
    if (!target) {
      return;
    }

    try {
      if (target.scrollIntoView) {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    } catch {}

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };

    try {
      target.dispatchEvent(new MouseEvent('dblclick', mouseInit));
    } catch {}
  }

  async function openDirectoryByName(expectedName, options = {}) {
    const previousSnapshot = options.previousSnapshot || getDirectoryContextSnapshot();
    const childItem = options.childItem || null;

    if (childItem && !isSyntheticDomId(childItem.fileId || childItem.dirId || '')) {
      const directHash = buildChildDirectoryHash(previousSnapshot, childItem);
      const directSnapshot = await navigateToDirectoryHash(directHash, previousSnapshot, {
        expectedName,
        timeoutMs: 4600,
        intervalMs: 180,
        stableMs: 420,
      });
      if (directSnapshot) {
        return directSnapshot;
      }
    }

    const rowEntry = options.rowEntry || await locateDirectoryRowByName(expectedName, options);
    if (!rowEntry?.row) {
      return null;
    }

    const targets = dedupeElements([
      getDirectoryOpenTarget(rowEntry.row, expectedName),
      rowEntry.row,
    ]);

    for (const target of targets) {
      triggerSyntheticClick(target);
      let changed = await waitForDirectoryChange(previousSnapshot, {
        timeoutMs: Number(options.timeoutMs || 4200),
        intervalMs: 120,
      });
      if (changed) {
        await sleep(520);
        const fresh = await waitForFreshDirectoryContext(previousSnapshot, {
          expectedName,
          timeoutMs: 2400,
          intervalMs: 180,
          stableMs: 360,
        });
        if (fresh) {
          return fresh;
        }
      }

      triggerSyntheticDblClick(target);
      changed = await waitForDirectoryChange(previousSnapshot, {
        timeoutMs: Number(options.timeoutMs || 4200),
        intervalMs: 120,
      });
      if (changed) {
        await sleep(520);
        const fresh = await waitForFreshDirectoryContext(previousSnapshot, {
          expectedName,
          timeoutMs: 2400,
          intervalMs: 180,
          stableMs: 360,
        });
        if (fresh) {
          return fresh;
        }
      }
    }

    return null;
  }

  function collectBreadcrumbTargets(expectedName = '') {
    const expected = normalizeDomName(expectedName);
    const selectors = [
      '[aria-label*="breadcrumb" i] a',
      '[aria-label*="breadcrumb" i] button',
      '[aria-label*="breadcrumb" i] [role="link"]',
      '[aria-label*="breadcrumb" i] [role="button"]',
      '[class*="breadcrumb"] a',
      '[class*="breadcrumb"] button',
      '[class*="breadcrumb"] [role="link"]',
      '[class*="breadcrumb"] [role="button"]',
      '[class*="crumb"] a',
      '[class*="crumb"] button',
      '[class*="crumb"] [role="link"]',
      '[class*="crumb"] [role="button"]',
      '[class*="path"] a',
      '[class*="path"] button',
      '[class*="path"] [role="link"]',
      '[class*="path"] [role="button"]',
      'nav a',
      'nav button',
      'nav [role="link"]',
      'nav [role="button"]',
    ];

    const nodes = dedupeElements(Array.from(document.querySelectorAll(selectors.join(', '))))
      .filter((node) => isVisibleElement(node) && !isHelperPanelNode(node) && !node.querySelector('a, button, [role="link"], [role="button"]'));

    return nodes
      .map((node) => {
        const text = cleanDirectoryTitleCandidate(getVisibleNodeText(node));
        const normalizedText = normalizeDomName(text);
        if (!normalizedText || node.getAttribute?.('aria-current') === 'page') {
          return null;
        }
        if (ROOT_DIRECTORY_NAMES.has(normalizedText) && normalizedText !== expected) {
          return null;
        }
        let score = 0;
        if (expected) {
          if (!textLooksLikeExpected(normalizedText, expected)) {
            return null;
          }
          score += normalizedText === expected ? 200 : 120;
        }
        if (node.matches && node.matches('a, button, [role="link"], [role="button"]')) {
          score += 40;
        }
        return { node, text: normalizedText, score };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
  }

  async function returnToDirectorySnapshot(targetSnapshot, options = {}) {
    if (!targetSnapshot) {
      return false;
    }

    const alreadyThere = await waitForDirectoryMatch(targetSnapshot, {
      timeoutMs: 120,
      intervalMs: 60,
    });
    if (alreadyThere) {
      return true;
    }

    const hashMatched = await navigateToDirectoryHash(targetSnapshot.hash, getDirectoryContextSnapshot(), {
      expectedName: targetSnapshot.name,
      timeoutMs: Number(options.timeoutMs || 4200),
      intervalMs: 180,
      stableMs: 420,
    });
    if (hashMatched && isSameDirectorySnapshot(targetSnapshot, hashMatched)) {
      await sleep(260);
      return true;
    }

    const breadcrumbTargets = collectBreadcrumbTargets(targetSnapshot.name);
    const bestTarget = breadcrumbTargets[0] || null;
    if (bestTarget) {
      triggerSyntheticClick(bestTarget.node);
      const matched = await waitForDirectoryMatch(targetSnapshot, {
        timeoutMs: Number(options.timeoutMs || 4200),
        intervalMs: 120,
      });
      if (matched) {
        await sleep(420);
        return true;
      }
    }

    const historyBackTries = Math.max(1, Number(options.historyBackTries || 1));
    for (let index = 0; index < historyBackTries; index += 1) {
      try {
        window.history.back();
      } catch {}

      const matched = await waitForDirectoryMatch(targetSnapshot, {
        timeoutMs: Number(options.timeoutMs || 4200),
        intervalMs: 120,
      });
      if (matched) {
        await sleep(420);
        return true;
      }
    }

    return false;
  }

  async function inspectCurrentDirectoryForEmptyScan(options = {}) {
    const currentSnapshot = getDirectoryContextSnapshot();
    const parentId = String(options.parentId || currentSnapshot.parentId || '').trim();
    if (!parentId || isSyntheticDomId(parentId)) {
      return {
        items: [],
        childDirs: [],
        visibleRows: [],
        emptyStateInfo: { visible: false, text: '', via: '' },
        isEmpty: false,
        uncertain: true,
        requestError: new Error(!parentId ? '当前目录 parentId 为空' : `当前目录仍是伪 ID：${parentId}`),
      };
    }

    let items = [];
    let visibleRows = [];
    let requestError = null;
    let emptyStateInfo = {
      visible: false,
      text: '',
      via: '',
    };
    const maxAttempts = Math.max(2, Number(options.maxAttempts || 3));
    const settleDelayMs = Math.max(240, Number(options.settleDelayMs || 800));

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      requestError = null;
      let apiItems = [];
      try {
        apiItems = await fetchCurrentList({ parentId });
      } catch (err) {
        requestError = err;
      }

      const snapshotItems = buildCurrentDirectoryItemsSnapshot(parentId);
      items = dedupeItems([...(Array.isArray(apiItems) ? apiItems : []), ...snapshotItems]);
      visibleRows = collectVisibleListRowEntries();
      emptyStateInfo = findVisibleEmptyStateInfo();
      const childDirs = buildEmptyScanChildDirs(items, visibleRows);
      const hasRenderableContent = Boolean(items.length || visibleRows.length || childDirs.length);
      const stillOnExpectedDirectory = !getDirectoryContextSnapshot().parentId || getDirectoryContextSnapshot().parentId === parentId;

      if (hasRenderableContent) {
        break;
      }

      if (emptyStateInfo.visible && stillOnExpectedDirectory && !requestError) {
        break;
      }

      if (attempt >= maxAttempts - 1) {
        break;
      }

      await sleep(settleDelayMs);
    }

    const childDirs = buildEmptyScanChildDirs(items, visibleRows);
    const hasRenderableContent = Boolean(items.length || visibleRows.length || childDirs.length);
    const isEmptyConfirmed = !hasRenderableContent && emptyStateInfo.visible && !requestError;
    const isUncertain = !hasRenderableContent && !isEmptyConfirmed;
    return {
      items,
      childDirs,
      visibleRows,
      emptyStateInfo,
      isEmpty: isEmptyConfirmed,
      uncertain: isUncertain,
      requestError,
    };
  }

  function collectVisibleDuplicateRows(expectedNames = null) {
    const duplicateRe = getDuplicateRegex();
    const expectedSet =
      expectedNames && expectedNames.length
        ? new Set(expectedNames.map((name) => normalizeDomName(name)))
        : null;
    const rows = getListRows();

    return rows
      .map((row, index) => {
        const expectedName = findExpectedNameInRow(row, expectedSet);
        const name = expectedName || extractNameFromRow(row);
        const checkbox = getCheckboxInRow(row);
        return {
          index,
          row,
          name,
          normalizedName: normalizeDomName(name),
          checkbox,
        };
      })
      .filter((item) => {
        if (!item.checkbox || !isProbablyUsefulName(item.name)) {
          return false;
        }
        if (expectedSet && expectedSet.size) {
          return expectedSet.has(item.normalizedName);
        }
        return duplicateRe.test(item.name);
      });
  }

  function collectRowsByDocumentSearch(expectedNames = []) {
    const expectedList = Array.from(new Set((expectedNames || []).map((name) => normalizeDomName(name)).filter(Boolean)));
    if (!expectedList.length) {
      return [];
    }

    const nodes = Array.from(
      document.querySelectorAll('[title], [aria-label], [data-name], [data-filename], span, div, p, a, strong, td')
    );
    const rows = [];

    for (const node of nodes) {
      if (!isVisibleElement(node) || isHelperPanelNode(node)) {
        continue;
      }

      const texts = dedupeElements([
        node.getAttribute && node.getAttribute('title'),
        node.getAttribute && node.getAttribute('aria-label'),
        node.getAttribute && node.getAttribute('data-name'),
        node.getAttribute && node.getAttribute('data-filename'),
        node.textContent,
      ]).map((x) => String(x || ''));

      const matchedExpected = expectedList.find((expected) => texts.some((text) => textLooksLikeExpected(text, expected)));
      if (!matchedExpected) {
        continue;
      }

      const row = getClosestRow(node);
      if (isHelperPanelNode(row) || !isUsableListRow(row)) {
        continue;
      }
      const checkbox = getCheckboxInRow(row);
      if (!row || !checkbox) {
        continue;
      }

      rows.push({
        row,
        checkbox,
        name: matchedExpected,
        normalizedName: matchedExpected,
      });
    }

    return dedupeElements(rows.map((item) => item.row)).map((row, index) => ({
      index,
      row,
      checkbox: getCheckboxInRow(row),
      name: expectedList.find((expected) => textLooksLikeExpected(row.innerText || row.textContent || '', expected)) || extractNameFromRow(row),
      normalizedName: normalizeDomName(
        expectedList.find((expected) => textLooksLikeExpected(row.innerText || row.textContent || '', expected)) || extractNameFromRow(row)
      ),
    })).filter((item) => item.checkbox);
  }

  function triggerSyntheticClick(target) {
    if (!target) {
      return;
    }

    try {
      if (target.scrollIntoView) {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    } catch {}

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        const EventCtor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        target.dispatchEvent(new EventCtor(type, mouseInit));
      } catch {}
    }

    try {
      if (typeof target.click === 'function') {
        target.click();
      }
    } catch {}
  }

  async function toggleCheckboxRobustly(item) {
    const targets = dedupeElements([
      item.checkbox,
      item.checkbox?.closest?.('label, button, [role="checkbox"]'),
      item.row,
      item.row?.querySelector?.('label[role="checkbox"], [role="checkbox"], input[type="checkbox"], [class*="checkbox"], [class*="check"]'),
    ]);

    for (const target of targets) {
      triggerSyntheticClick(target);
      await sleep(120);
      if (isElementChecked(item.checkbox)) {
        return true;
      }
    }

    return isElementChecked(item.checkbox);
  }

  async function selectDuplicateRows(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    let duplicates = getSelectedDuplicatePreviewItems();
    try {
      if (!duplicates.length) {
        const previewItems = await previewDuplicates({
          refresh: Boolean(options.refresh),
          listBody: options.listBody || {},
        });
        setDuplicatePreview(previewItems, { preserveSelection: true });
        duplicates = getSelectedDuplicatePreviewItems();
      }
    } catch (err) {
      warn('重复项预览失败，改为直接扫描当前可见行：', err);
    }

    const expectedNames = duplicates.map((item) => item.name);
    const pendingNames = new Set(expectedNames.map((name) => normalizeDomName(name)).filter(Boolean));
    const matchedNames = new Set();
    const visibleOnlyMode = !pendingNames.size;

    if (visibleOnlyMode) {
      warn('接口没有识别到重复项，勾选将退回为当前页面可见项扫描模式。');
    }

    let clicked = 0;
    let skipped = 0;
    const container = findScrollableListContainer();
    const maxRounds = visibleOnlyMode ? 1 : 24;

    if (container && !visibleOnlyMode) {
      const isDocumentScroller =
        container === document.scrollingElement ||
        container === document.documentElement ||
        container === document.body;
      if (isDocumentScroller) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        container.scrollTop = 0;
      }
      await controlledDelay(160, taskControl);
    }

    for (let round = 0; round < maxRounds; round += 1) {
      await waitForTaskControl(taskControl);
      const targetNames = visibleOnlyMode ? null : Array.from(pendingNames);
      let visibleRows = collectVisibleDuplicateRows(targetNames);
      if (!visibleRows.length && targetNames && targetNames.length) {
        visibleRows = collectRowsByDocumentSearch(targetNames);
      }

      for (let i = 0; i < visibleRows.length; i += 1) {
        await waitForTaskControl(taskControl);
        const item = visibleRows[i];
        if (matchedNames.has(item.normalizedName)) {
          continue;
        }

        matchedNames.add(item.normalizedName);
        pendingNames.delete(item.normalizedName);

        updatePanelStatus(
          visibleOnlyMode
            ? `勾选当前可见重复项 ${matchedNames.size} | 当前：${shortDisplayName(item.name)}`
            : `勾选重复项 ${matchedNames.size}/${duplicates.length} | 当前：${shortDisplayName(item.name)}`
        );
        if (onProgress) {
          onProgress({
            visible: true,
            percent: visibleOnlyMode
              ? Math.min(95, matchedNames.size * 12)
              : Math.min(95, (matchedNames.size / Math.max(1, duplicates.length)) * 100),
            indeterminate: false,
            text: visibleOnlyMode
              ? `勾选当前可见重复项 ${matchedNames.size} | 当前：${shortDisplayName(item.name)}`
              : `勾选重复项 ${matchedNames.size}/${duplicates.length} | 当前：${shortDisplayName(item.name)}`,
          });
        }

        if (!isElementChecked(item.checkbox)) {
          const checked = await toggleCheckboxRobustly(item);
          if (checked) {
            clicked += 1;
          }
        } else {
          skipped += 1;
        }
      }

      if (visibleOnlyMode || !pendingNames.size) {
        break;
      }

      const deltaY = Math.max(280, Math.floor((container?.clientHeight || window.innerHeight || 640) * 0.75));
      await waitForTaskControl(taskControl);
      const moved = await scrollListContainer(container, deltaY);
      if (!moved) {
        break;
      }
    }

    const missing = Array.from(pendingNames);
    if (!matchedNames.size) {
      updatePanelStatus(visibleOnlyMode ? '当前页面没有识别到可勾选的重复项' : `接口识别到 ${duplicates.length} 个重复项，但页面里一个都没定位到`);
      return { matched: 0, clicked: 0, skipped: 0, missing };
    }

    updatePanelStatus(
      missing.length
        ? `接口识别 ${duplicates.length} 个，已定位 ${matchedNames.size} 个，勾选 ${clicked} 个，剩余 ${missing.length} 个未定位`
        : `重复项已定位 ${matchedNames.size} 个，勾选 ${clicked} 个，已跳过 ${skipped} 个`
    );
    if (onProgress) {
      onProgress({
        visible: true,
        percent: 100,
        indeterminate: false,
        text: missing.length
          ? `接口识别 ${duplicates.length} 个，已定位 ${matchedNames.size} 个，勾选 ${clicked} 个，剩余 ${missing.length} 个未定位`
          : `重复项已定位 ${matchedNames.size} 个，勾选 ${clicked} 个，已跳过 ${skipped} 个`,
      });
    }
    console.table(Array.from(matchedNames).map((name) => ({ name })));
    return { matched: matchedNames.size, clicked, skipped, missing };
  }

  async function collectCheckedDuplicateTargets(duplicates, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const expectedNames = duplicates.map((item) => item.name);
    const pendingNames = new Set(expectedNames.map((name) => normalizeDomName(name)).filter(Boolean));
    const checkedNames = new Set();
    const scannedNames = new Set();
    const container = findScrollableListContainer();
    const maxRounds = 24;

    if (container) {
      const isDocumentScroller =
        container === document.scrollingElement ||
        container === document.documentElement ||
        container === document.body;
      if (isDocumentScroller) {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        container.scrollTop = 0;
      }
      await controlledDelay(180, taskControl);
    }

    for (let round = 0; round < maxRounds; round += 1) {
      await waitForTaskControl(taskControl);
      const targetNames = Array.from(pendingNames);
      let visibleRows = collectVisibleDuplicateRows(targetNames);
      if (!visibleRows.length && targetNames.length) {
        visibleRows = collectRowsByDocumentSearch(targetNames);
      }

      for (const item of visibleRows) {
        scannedNames.add(item.normalizedName);
        pendingNames.delete(item.normalizedName);
        if (isElementChecked(item.checkbox)) {
          checkedNames.add(item.normalizedName);
        } else {
          checkedNames.delete(item.normalizedName);
        }
      }

      if (onProgress) {
        onProgress({
          visible: true,
          percent: Math.min(95, ((round + 1) / maxRounds) * 100),
          indeterminate: false,
          text: `正在读取当前勾选状态 | 已扫描 ${scannedNames.size}/${duplicates.length} | 已勾选 ${checkedNames.size}`,
        });
      }

      if (!pendingNames.size) {
        break;
      }

      const deltaY = Math.max(280, Math.floor((container?.clientHeight || window.innerHeight || 640) * 0.75));
      await waitForTaskControl(taskControl);
      const moved = await scrollListContainer(container, deltaY);
      if (!moved) {
        break;
      }
    }

    const checkedTargets = duplicates.filter((item) => checkedNames.has(normalizeDomName(item.name)));
    return {
      checkedTargets,
      checkedNames,
      scannedNames,
      missing: duplicates.filter((item) => !scannedNames.has(normalizeDomName(item.name))),
    };
  }

  function getTaskProgressState(payload, fallbackPercent = 10) {
    const raw = Number(findFirstValueByKeys(payload, ['progress', 'percent', 'percentage']));
    if (!Number.isFinite(raw)) {
      return {
        percent: fallbackPercent,
        indeterminate: true,
      };
    }
    if (raw <= 1) {
      return {
        percent: Math.max(0, Math.min(100, raw * 100)),
        indeterminate: false,
      };
    }
    return {
      percent: Math.max(0, Math.min(100, raw)),
      indeterminate: false,
    };
  }

  function getTaskProgressText(payload, attempt, maxTries, expectedTotal = 0) {
    const status = extractTaskStatus(payload) || 'UNKNOWN';
    const counts = extractTaskCounts(payload, expectedTotal);
    const parts = [`任务状态: ${getTaskStatusLabel(status)}`, `轮询 ${attempt}/${maxTries}`];

    if (counts.total > 0) {
      parts.push(counts.hasExplicitCounts ? `已处理 ${counts.processed}/${counts.total}` : `目标 ${counts.total} 项`);
    }
    if (counts.hasSuccessCount) {
      parts.push(`成功 ${counts.success}`);
    }
    if (counts.hasFailedCount) {
      parts.push(`失败 ${counts.failed}`);
    }
    return parts.join(' | ');
  }

  async function waitTaskUntilDone(taskId, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const maxTries = Number(options.maxTries || CONFIG.batch.taskPollMaxTries || 30);
    const intervalMs = Number(options.intervalMs || CONFIG.batch.taskPollMs || 1200);
    const expectedTotal = Number(options.expectedTotal || 0);
    let lastResult = null;

    for (let attempt = 1; attempt <= maxTries; attempt += 1) {
      await waitForTaskControl(taskControl);
      const result = await getTaskStatus(taskId);
      lastResult = result;
      const progress = getTaskProgressState(result.payload, 10);

      if (onProgress) {
        onProgress({
          visible: true,
          percent: Math.max(10, progress.percent),
          indeterminate: progress.indeterminate,
          text: getTaskProgressText(result.payload, attempt, maxTries, expectedTotal),
        });
      }

      if (!result.ok) {
        throw new Error(`任务状态查询失败：HTTP ${result.status}`);
      }

      if (isTaskFinished(result.payload, { expectedTotal })) {
        return {
          ok: isTaskSuccessful(result.payload, { expectedTotal }),
          taskId,
          result,
          timeout: false,
        };
      }

      if (attempt < maxTries) {
        await controlledDelay(intervalMs, taskControl);
      }
    }

    return {
      ok: false,
      taskId,
      result: lastResult,
      timeout: true,
    };
  }

  function removeDuplicatePreviewItemsByIds(fileIds, options = {}) {
    const deletedIds = new Set((fileIds || []).map((id) => String(id)));
    if (!deletedIds.size) {
      return;
    }

    removeCapturedItemsByIds(Array.from(deletedIds));
    setDuplicatePreview(
      (STATE.duplicatePreviewItems || []).filter((item) => !deletedIds.has(String(item.fileId))),
      { preserveSelection: options.preserveSelection !== false }
    );
  }

  async function verifyDeletedItemsByList(targets, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const maxRounds = Math.max(1, Number(options.maxRounds || 8));
    const intervalMs = Math.max(300, Number(options.intervalMs || 1800));
    const verifiedPageSize = Math.max(
      Number(UI.fields.pageSize?.value || 0),
      Number(CONFIG.request.manualListBody.pageSize || 0),
      Number(getCapturedItems().length || 0),
      Number((targets || []).length || 0) + 50,
      200
    );
    const sourceTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    let remaining = sourceTargets.slice();
    let confirmedDeleted = [];
    let lastError = null;

    for (let round = 1; round <= maxRounds; round += 1) {
      await waitForTaskControl(taskControl);
      try {
        const items = await fetchCurrentList({ pageSize: verifiedPageSize, __returnBatchOnly: true });
        const existingIds = new Set((items || []).map((item) => String(item.fileId)));
        remaining = sourceTargets.filter((item) => existingIds.has(String(item.fileId)));
        confirmedDeleted = sourceTargets.filter((item) => !existingIds.has(String(item.fileId)));

        if (onProgress) {
          onProgress({
            visible: true,
            percent: Math.min(99, 82 + (round / maxRounds) * 16),
            indeterminate: false,
            text: `任务状态未确认，正在刷新目录核对删除结果 | 已确认 ${confirmedDeleted.length}/${sourceTargets.length} | 第 ${round}/${maxRounds} 次`,
          });
        }

        if (!remaining.length) {
          return {
            ok: true,
            deletedItems: confirmedDeleted,
            remaining: [],
            rounds: round,
            pageSize: verifiedPageSize,
          };
        }
      } catch (err) {
        lastError = err;
        warn('删除结果核对时刷新目录失败：', err);
      }

      if (round < maxRounds) {
        await controlledDelay(intervalMs, taskControl);
      }
    }

    return {
      ok: false,
      deletedItems: confirmedDeleted,
      remaining,
      rounds: maxRounds,
      pageSize: verifiedPageSize,
      error: lastError,
    };
  }

  async function verifyMovedItemsByList(targets, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const maxRounds = Math.max(1, Number(options.maxRounds || 6));
    const intervalMs = Math.max(300, Number(options.intervalMs || 1500));
    const verifiedPageSize = Math.max(
      Number(UI.fields.pageSize?.value || 0),
      Number(CONFIG.request.manualListBody.pageSize || 0),
      Number(getCapturedItems().length || 0),
      Number((targets || []).length || 0) + 50,
      200
    );
    const sourceTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    let remaining = sourceTargets.slice();
    let movedItems = [];
    let lastError = null;

    for (let round = 1; round <= maxRounds; round += 1) {
      await waitForTaskControl(taskControl);
      try {
        const items = await fetchCurrentList({ pageSize: verifiedPageSize, __returnBatchOnly: true });
        const existingIds = new Set((items || []).map((item) => String(item.fileId)));
        remaining = sourceTargets.filter((item) => existingIds.has(String(item.fileId)));
        movedItems = sourceTargets.filter((item) => !existingIds.has(String(item.fileId)));

        if (onProgress) {
          onProgress({
            visible: true,
            percent: Math.min(99, 82 + (round / maxRounds) * 16),
            indeterminate: false,
            text: `任务状态未确认，正在刷新目录核对移动结果 | 已确认移走 ${movedItems.length}/${sourceTargets.length} | 第 ${round}/${maxRounds} 次`,
          });
        }

        if (!remaining.length) {
          return {
            ok: true,
            movedItems,
            remaining: [],
            rounds: round,
            pageSize: verifiedPageSize,
          };
        }
      } catch (err) {
        lastError = err;
        warn('移动结果核对时刷新目录失败：', err);
      }

      if (round < maxRounds) {
        await controlledDelay(intervalMs, taskControl);
      }
    }

    return {
      ok: false,
      movedItems,
      remaining,
      rounds: maxRounds,
      pageSize: verifiedPageSize,
      error: lastError,
    };
  }

  async function deleteDuplicateItems(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    if (!STATE.duplicatePreviewItems.length) {
      await waitForTaskControl(taskControl);
      const previewItems = await previewDuplicates({
        refresh: options.refresh !== false,
        listBody: options.listBody || {},
      });
      setDuplicatePreview(previewItems);
      throw new Error(`已加载 ${previewItems.length} 个重复项。请先在面板里取消不想删的项目，再点“删除重复项”。`);
    }

    let duplicates = getSelectedDuplicatePreviewItems();

    if (!duplicates.length) {
      warn('当前面板里没有勾选任何重复项。');
      return { ok: 0, fail: 0, deleted: 0, taskId: '', duplicates };
    }

    if (duplicates.some((item) => String(item.fileId || '').startsWith('dom:'))) {
      await waitForTaskControl(taskControl);
      const ensured = await ensureDuplicateItemsHaveRealIds(STATE.duplicatePreviewItems, {
        onProgress,
      });

      if (ensured.mergedItems.length) {
        updateDuplicatePreviewResolvedItems(ensured.mergedItems);
      }
      duplicates = getSelectedDuplicatePreviewItems();

      if (duplicates.some((item) => String(item.fileId || '').startsWith('dom:'))) {
        const unresolvedSelected = duplicates.filter((item) => String(item.fileId || '').startsWith('dom:'));
        throw new Error(
          `当前仍有 ${unresolvedSelected.length} 个重复项没拿到真实 fileId。已自动补齐 ${ensured.resolved.length} 项；请稍等页面继续加载这一批项目，或下拉目录后再重试。`
        );
      }

      updatePanelStatus(`已自动补齐真实 fileId，准备删除 ${duplicates.length} 个重复项`);
    }

    if (CONFIG.batch.confirmBeforeRun && !window.confirm(`准备删除面板里已勾选的 ${duplicates.length} 个重复项，是否继续？`)) {
      return { ok: 0, fail: 0, deleted: 0, taskId: '', duplicates };
    }

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 5,
        indeterminate: true,
        text: `正在提交删除任务，共 ${duplicates.length} 项`,
      });
    }

    await waitForTaskControl(taskControl);
    const deleteRes = await deleteFiles(duplicates.map((item) => item.fileId));
    if (!deleteRes.ok || !isProbablySuccess(deleteRes.payload, deleteRes)) {
      throw new Error(getErrorText(deleteRes.payload || deleteRes.text || `HTTP ${deleteRes.status}`));
    }

    const taskId = extractTaskId(deleteRes.payload);
    if (!taskId) {
      removeDuplicatePreviewItemsByIds(duplicates.map((item) => item.fileId));
      if (onProgress) {
        onProgress({
          visible: true,
          percent: 100,
          indeterminate: false,
          text: `删除请求已提交，共 ${duplicates.length} 项；接口未返回 taskId，无法轮询进度`,
        });
      }
      return {
        ok: duplicates.length,
        fail: 0,
        deleted: duplicates.length,
        taskId: '',
        duplicates,
        deleteRes,
      };
    }

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 10,
        indeterminate: true,
        text: `删除任务已提交，taskId: ${taskId}`,
      });
    }

    const task = await waitTaskUntilDone(taskId, {
      onProgress,
      taskControl,
      expectedTotal: duplicates.length,
      maxTries: Math.max(CONFIG.batch.taskPollMaxTries || 180, 180),
      intervalMs: Math.max(CONFIG.batch.taskPollMs || 1500, 1500),
    });
    if (!task.ok) {
      const payload = task.result?.payload || task.result?.text || {};
      warn('删除任务轮询未确认，准备改用目录列表核对结果：', {
        taskId,
        payload,
      });

      const verification = await verifyDeletedItemsByList(duplicates, {
        onProgress,
        taskControl,
        maxRounds: 8,
        intervalMs: 1800,
      });

      if (verification.deletedItems.length) {
        removeDuplicatePreviewItemsByIds(verification.deletedItems.map((item) => item.fileId));
      }

      if (verification.ok) {
        if (onProgress) {
          onProgress({
            visible: true,
            percent: 100,
            indeterminate: false,
            text: `删除已确认完成，共 ${verification.deletedItems.length} 项，taskId: ${taskId}`,
          });
        }

        return {
          ok: verification.deletedItems.length,
          fail: 0,
          deleted: verification.deletedItems.length,
          taskId,
          duplicates,
          task,
          verification,
        };
      }

      const partialText = verification.deletedItems.length
        ? `；已确认删除 ${verification.deletedItems.length} 项，剩余 ${verification.remaining.length} 项未确认`
        : '';
      const verifyErrorText = verification.error ? `；列表核对失败：${getErrorText(verification.error)}` : '';
      throw new Error(
        task.timeout
          ? `删除任务超时，taskId: ${taskId}${partialText}${verifyErrorText}`
          : `删除任务失败，taskId: ${taskId}，${getErrorText(payload) || '未返回更多信息'}${partialText}${verifyErrorText}`
      );
    }

    const taskCounts = extractTaskCounts(task.result?.payload, duplicates.length);
    const deletedCount = taskCounts.hasSuccessCount ? taskCounts.success : duplicates.length;
    const failedCount = taskCounts.hasFailedCount ? taskCounts.failed : 0;

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 100,
        indeterminate: false,
        text: `删除完成，共处理 ${deletedCount + failedCount} 项，成功 ${deletedCount} 项，失败 ${failedCount} 项，taskId: ${taskId}`,
      });
    }

    removeDuplicatePreviewItemsByIds(duplicates.map((item) => item.fileId));

    return {
      ok: deletedCount,
      fail: failedCount,
      deleted: deletedCount,
      taskId,
      duplicates,
      task,
    };
  }

  async function deleteEmptyDirItems(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const taskControl = options.taskControl || null;
    const scan = STATE.lastEmptyDirScan || null;
    if (!scan || !Array.isArray(scan.emptyDirs) || !scan.emptyDirs.length) {
      const result = await scanEmptyLeafDirectories({
        onProgress,
        taskControl,
      });
      if (!result.emptyDirs.length) {
        return { ok: 0, fail: 0, deleted: 0, taskId: '', emptyDirs: [] };
      }
    }

    const targets = getSelectedEmptyDirItems();
    if (!targets.length) {
      warn('当前面板里没有勾选任何空目录。');
      return { ok: 0, fail: 0, deleted: 0, taskId: '', emptyDirs: [] };
    }

    if (CONFIG.batch.confirmBeforeRun && !window.confirm(`准备删除面板里已勾选的 ${targets.length} 个空目录，是否继续？`)) {
      return { ok: 0, fail: 0, deleted: 0, taskId: '', emptyDirs: targets };
    }

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 5,
        indeterminate: true,
        text: `正在提交空目录删除任务，共 ${targets.length} 项`,
      });
    }

    await waitForTaskControl(taskControl);
    const deleteRes = await deleteFiles(targets.map((item) => item.fileId));
    if (!deleteRes.ok || !isProbablySuccess(deleteRes.payload, deleteRes)) {
      throw new Error(getErrorText(deleteRes.payload || deleteRes.text || `HTTP ${deleteRes.status}`));
    }

    const taskId = extractTaskId(deleteRes.payload);
    if (!taskId) {
      removeEmptyDirScanItemsByIds(targets.map((item) => item.fileId));
      if (onProgress) {
        onProgress({
          visible: true,
          percent: 100,
          indeterminate: false,
          text: `空目录删除请求已提交，共 ${targets.length} 项；接口未返回 taskId，先按成功处理`,
        });
      }
      return {
        ok: targets.length,
        fail: 0,
        deleted: targets.length,
        taskId: '',
        emptyDirs: targets,
        deleteRes,
      };
    }

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 10,
        indeterminate: true,
        text: `空目录删除任务已提交，taskId: ${taskId}`,
      });
    }

    const task = await waitTaskUntilDone(taskId, {
      onProgress,
      taskControl,
      expectedTotal: targets.length,
      maxTries: Math.max(CONFIG.batch.taskPollMaxTries || 180, 180),
      intervalMs: Math.max(CONFIG.batch.taskPollMs || 1500, 1500),
    });
    if (!task.ok) {
      const payload = task.result?.payload || task.result?.text || {};
      throw new Error(
        task.timeout
          ? `空目录删除任务超时，taskId: ${taskId}`
          : `空目录删除任务失败，taskId: ${taskId}，${getErrorText(payload) || '未返回更多信息'}`
      );
    }

    const taskCounts = extractTaskCounts(task.result?.payload, targets.length);
    const deletedCount = taskCounts.hasSuccessCount ? taskCounts.success : targets.length;
    const failedCount = taskCounts.hasFailedCount ? taskCounts.failed : 0;
    removeEmptyDirScanItemsByIds(targets.map((item) => item.fileId));

    if (onProgress) {
      onProgress({
        visible: true,
        percent: 100,
        indeterminate: false,
        text: `空目录删除完成，共处理 ${deletedCount + failedCount} 项，成功 ${deletedCount} 项，失败 ${failedCount} 项，taskId: ${taskId}`,
      });
    }

    return {
      ok: deletedCount,
      fail: failedCount,
      deleted: deletedCount,
      taskId,
      emptyDirs: targets,
      task,
    };
  }

  function getStatusSummary(extraText = '') {
    const mergedHeaders = getMergedHeaders();
    const context = getCurrentListContext();
    const magnetStats = getSelectedMagnetImportStats();
    const bits = [
      mergedHeaders.authorization ? '授权已就绪' : '授权未就绪',
      context.parentId ? `目录已识别` : '目录未识别',
      `已累计 ${context.capturedCount || getCapturedItems().length} 项`,
      `来源:${getItemsSourceLabel()}`,
      STATE.lastRenameRequest?.url ? '改名请求已学习' : '改名请求未学习',
    ];

    if (magnetStats.fileCount > 0) {
      bits.push(`磁力文本 ${magnetStats.fileCount} 个 / 磁力 ${magnetStats.magnetCount} 条`);
    }

    if (STATE.lastEmptyDirScan) {
      bits.push(`空目录 ${Number(STATE.lastEmptyDirScan.emptyDirs?.length || 0)} 个`);
    }

    if (context.batchCount > 1) {
      bits.push(`已合并 ${context.batchCount} 批`);
    }

    if (extraText) {
      bits.push(extraText);
    }
    return bits.join(' | ');
  }

  function updatePanelStatus(extraText = '') {
    if (UI.status) {
      UI.status.textContent = getStatusSummary(extraText);
    }
    if (UI.summary) {
      const context = getCurrentListContext();
      const duplicateSelected = getSelectedDuplicatePreviewItems().length;
      const duplicateTotal = (STATE.duplicatePreviewItems || []).length;
      const magnetStats = getSelectedMagnetImportStats();
      const cloudSummary = STATE.lastCloudImportSummary || null;
      const emptyDirSummary = STATE.lastEmptyDirScan || null;
      const authStatus = STATE.headers.authorization
        ? '已自动识别最新认证'
        : (CONFIG.request.manualHeaders.authorization ? '使用手填认证兜底' : '未识别');
      UI.summary.textContent = [
        `parentId: ${context.parentId || '(未获取)'}`,
        `当前目录累计: ${context.capturedCount || getCapturedItems().length}`,
        `最近一批: ${context.lastBatchSize || 0}`,
        `已捕获批次: ${context.batchCount || 0}`,
        `listUrl: ${context.listUrl || '(未识别)'}`,
        `认证: ${authStatus}`,
        `预处理: ${getRuleModeLabel()}`,
        `改名方式: ${getRenameOutputModeLabel()}`,
        `重复项编号: ${CONFIG.duplicate.numbers || DEFAULT_DUPLICATE_NUMBERS}`,
        `删除勾选: ${duplicateSelected}/${duplicateTotal}`,
        `磁力文本: ${magnetStats.fileCount} 个`,
        `磁力条数: ${magnetStats.magnetCount} 条`,
        `云添加每批: ${CONFIG.cloud.maxFilesPerTask || 500} 文件`,
        `云添加目录前缀: ${CONFIG.cloud.sourceDirPrefix || '磁力导入'}`,
        emptyDirSummary
          ? `最近空目录扫描: 空目录 ${emptyDirSummary.emptyDirs?.length || 0} / 已扫目录 ${emptyDirSummary.scannedDirs || 0}${emptyDirSummary.truncated ? ' / 可能未扫全' : ''}`
          : '最近空目录扫描: 暂无记录',
        cloudSummary
          ? `最近云添加: 成功磁力 ${cloudSummary.submittedMagnets || 0} / 跳过 ${cloudSummary.skippedMagnets || 0} / 失败 ${cloudSummary.failedMagnets || 0} / 提交批次 ${cloudSummary.submittedTaskBatches || 0}`
          : '最近云添加: 暂无记录',
        '说明: 页面继续下拉时，新一批 get_file_list 会自动累计进当前目录。',
      ].join('\n');
    }
  }


  function createTaskAbortError(message = '已停止当前任务') {
    const error = new Error(String(message || '已停止当前任务'));
    error.name = 'GypTaskAbortError';
    error.isUserAbort = true;
    return error;
  }

  function isTaskAbortError(err) {
    return Boolean(err && (err.isUserAbort || err.name === 'GypTaskAbortError'));
  }

  function getActiveTaskControl() {
    return STATE.activeTaskControl || null;
  }

  function releaseTaskControlWaiters(control) {
    if (!control || !Array.isArray(control.waiters) || !control.waiters.length) {
      return;
    }
    const waiters = control.waiters.splice(0, control.waiters.length);
    for (const resolve of waiters) {
      try {
        resolve();
      } catch {}
    }
  }

  function syncTaskControlUi() {
    if (!UI.pauseTaskButton || !UI.stopTaskButton) {
      return;
    }
    const control = getActiveTaskControl();
    const hasActive = Boolean(control);
    UI.pauseTaskButton.disabled = !hasActive;
    UI.stopTaskButton.disabled = !hasActive;
    UI.pauseTaskButton.textContent = hasActive && control.paused ? '继续' : '暂停';
  }

  function beginTaskControl(label = '') {
    const control = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: String(label || '当前任务'),
      paused: false,
      stopped: false,
      waiters: [],
    };
    STATE.activeTaskControl = control;
    syncTaskControlUi();
    return control;
  }

  function finishTaskControl(control) {
    if (control && STATE.activeTaskControl === control) {
      STATE.activeTaskControl = null;
    }
    syncTaskControlUi();
  }

  function togglePauseActiveTask() {
    const control = getActiveTaskControl();
    if (!control || control.stopped) {
      return false;
    }

    control.paused = !control.paused;
    if (!control.paused) {
      releaseTaskControlWaiters(control);
    }
    syncTaskControlUi();

    const baseState = STATE.lastProgressState || {
      visible: true,
      percent: 0,
      indeterminate: true,
      text: control.label || '当前任务',
    };
    setProgressBar({
      ...baseState,
      visible: true,
      text: control.paused
        ? `已暂停 | ${baseState.text || control.label || '当前任务'}`
        : String(baseState.text || control.label || '当前任务').replace(/^已暂停\s*\|\s*/u, ''),
    });
    updatePanelStatus(`${control.paused ? '已暂停' : '已继续'}：${control.label || '当前任务'}`);
    return true;
  }

  function stopActiveTask() {
    const control = getActiveTaskControl();
    if (!control || control.stopped) {
      return false;
    }

    control.stopped = true;
    control.paused = false;
    releaseTaskControlWaiters(control);
    syncTaskControlUi();

    const baseState = STATE.lastProgressState || {
      visible: true,
      percent: 100,
      indeterminate: false,
      text: control.label || '当前任务',
    };
    setProgressBar({
      ...baseState,
      visible: true,
      indeterminate: false,
      percent: Math.max(0, Math.min(100, Number(baseState.percent || 100))),
      text: `正在停止 | ${baseState.text || control.label || '当前任务'}`,
    });
    updatePanelStatus(`正在停止：${control.label || '当前任务'}（会在当前步骤结束后停下）`);
    return true;
  }

  async function waitForTaskControl(taskControl) {
    if (!taskControl) {
      return;
    }
    if (taskControl.stopped) {
      throw createTaskAbortError(`${taskControl.label || '当前任务'}已停止`);
    }

    while (taskControl.paused) {
      await new Promise((resolve) => {
        taskControl.waiters.push(resolve);
      });
      if (taskControl.stopped) {
        throw createTaskAbortError(`${taskControl.label || '当前任务'}已停止`);
      }
    }

    if (taskControl.stopped) {
      throw createTaskAbortError(`${taskControl.label || '当前任务'}已停止`);
    }
  }

  async function controlledDelay(ms, taskControl) {
    let remaining = Math.max(0, Number(ms || 0));
    while (remaining > 0) {
      await waitForTaskControl(taskControl);
      const step = Math.min(150, remaining);
      await sleep(step);
      remaining -= step;
    }
    await waitForTaskControl(taskControl);
  }

  async function runWithTaskControl(label, taskRunner) {
    const control = beginTaskControl(label);
    try {
      return await taskRunner(control);
    } finally {
      finishTaskControl(control);
    }
  }

  function setProgressBar(state = {}) {
    if (!UI.progressWrap || !UI.progressBar || !UI.progressText) {
      return;
    }

    const visible = Boolean(state.visible);
    const percent = Math.max(0, Math.min(100, Number(state.percent || 0)));
    const indeterminate = Boolean(state.indeterminate);
    const control = getActiveTaskControl();
    let text = state.text || '';
    if (visible && control?.paused) {
      text = `已暂停 | ${text || control.label || '当前任务'}`;
    } else if (visible && control?.stopped) {
      text = `正在停止 | ${text || control.label || '当前任务'}`;
    }

    STATE.lastProgressState = {
      visible,
      percent,
      indeterminate,
      text: state.text || '',
    };

    UI.progressWrap.style.display = visible ? 'block' : 'none';
    if (!visible) {
      UI.progressBar.style.width = '0%';
      UI.progressText.textContent = '';
      return;
    }

    UI.progressBar.classList.toggle('gyp-indeterminate', indeterminate);
    UI.progressBar.style.width = indeterminate ? '36%' : `${percent}%`;
    UI.progressText.textContent = text;
  }

  function syncPanelFromConfig(options = {}) {
    if (!UI.root) {
      return;
    }

    const fillEmptyOnly = Boolean(options.fillEmptyOnly);
    const firstRule = CONFIG.rename.rules[0] || {};
    const context = getCurrentListContext();
    const ruleMode = getCurrentRuleMode(firstRule);
    const output = CONFIG.rename.output || {};
    const values = {
      ruleMode,
      outputMode: output.mode || 'keep-clean',
      authorization: STATE.headers.authorization || CONFIG.request.manualHeaders.authorization || '',
      did: STATE.headers.did || CONFIG.request.manualHeaders.did || '',
      dt: STATE.headers.dt || CONFIG.request.manualHeaders.dt || '',
      parentId: context.parentId || CONFIG.request.manualListBody.parentId || '',
      pageSize: String(CONFIG.request.manualListBody.pageSize || context.pageSize || 100),
      template: output.template || CONFIG.rename.template || '{clean}',
      duplicateNumbers: CONFIG.duplicate.numbers || DEFAULT_DUPLICATE_NUMBERS,
      cloudBatchLimit: String(CONFIG.cloud.maxFilesPerTask || 500),
      cloudDirPrefix: CONFIG.cloud.sourceDirPrefix || '磁力导入',
      moveTargetParentId: CONFIG.move.targetParentId || '',
      ruleSearchText: firstRule.type === 'text' ? (firstRule.search || '') : '',
      ruleReplaceText: firstRule.type === 'text' ? (firstRule.replace || '') : '',
      addText: output.addText || '',
      addPosition: output.addPosition || 'suffix',
      outputFindText: output.findText || '',
      outputReplaceText: output.replaceText || '',
      formatStyle: output.formatStyle || 'text-and-index',
      formatText: output.formatText || '文件',
      formatPosition: output.formatPosition || 'suffix',
      startIndex: String(output.startIndex ?? 0),
      exampleName: getDefaultExampleName(),
      rulePattern: firstRule.pattern || DEFAULT_LEADING_BRACKET_PATTERN,
      ruleFlags: firstRule.flags || '',
      ruleReplace: firstRule.replace || '',
      delayMs: String(CONFIG.batch.delayMs ?? 300),
    };

    for (const [key, value] of Object.entries(values)) {
      const el = UI.fields[key];
      if (!el) {
        continue;
      }
      if (!fillEmptyOnly || !el.value) {
        el.value = value;
      }
    }

    updatePanelStatus();
    updateRenameModePreview();
  }

  function applyPanelConfig() {
    if (!UI.root) {
      return;
    }

    const firstRule = CONFIG.rename.rules[0] || { enabled: true, type: 'regex' };
    CONFIG.rename.rules[0] = firstRule;
    const ruleMode = UI.fields.ruleMode?.value || 'remove-leading-bracket';

    CONFIG.request.manualHeaders.authorization = (UI.fields.authorization?.value || '').trim();
    CONFIG.request.manualHeaders.did = (UI.fields.did?.value || '').trim();
    CONFIG.request.manualHeaders.dt = (UI.fields.dt?.value || '').trim();
    CONFIG.request.manualListBody.parentId = (UI.fields.parentId?.value || '').trim();

    const pageSize = Number(UI.fields.pageSize?.value || 100);
    CONFIG.request.manualListBody.pageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 100;

    CONFIG.rename.template = (UI.fields.template?.value || '{clean}').trim() || '{clean}';
    CONFIG.rename.ruleMode = ruleMode;
    firstRule.enabled = ruleMode !== 'none';
    firstRule.type = 'regex';
    firstRule.search = '';
    if (ruleMode === 'remove-leading-bracket') {
      firstRule.pattern = DEFAULT_LEADING_BRACKET_PATTERN;
      firstRule.flags = 'u';
      firstRule.replace = '';
    } else if (ruleMode === 'replace-text') {
      firstRule.type = 'text';
      firstRule.pattern = '';
      firstRule.flags = '';
      firstRule.search = UI.fields.ruleSearchText?.value || '';
      firstRule.replace = UI.fields.ruleReplaceText?.value || '';
    } else if (ruleMode === 'custom-regex') {
      firstRule.pattern = UI.fields.rulePattern?.value || '';
      firstRule.flags = UI.fields.ruleFlags?.value || '';
      firstRule.replace = UI.fields.ruleReplace?.value || '';
    }

    CONFIG.rename.output.mode = UI.fields.outputMode?.value || 'keep-clean';
    CONFIG.rename.output.addText = UI.fields.addText?.value || '';
    CONFIG.rename.output.addPosition = UI.fields.addPosition?.value || 'suffix';
    CONFIG.rename.output.findText = UI.fields.outputFindText?.value || '';
    CONFIG.rename.output.replaceText = UI.fields.outputReplaceText?.value || '';
    CONFIG.rename.output.formatStyle = UI.fields.formatStyle?.value || 'text-and-index';
    CONFIG.rename.output.formatText = UI.fields.formatText?.value || '文件';
    CONFIG.rename.output.formatPosition = UI.fields.formatPosition?.value || 'suffix';
    const startIndex = Number(UI.fields.startIndex?.value || 0);
    CONFIG.rename.output.startIndex = Number.isFinite(startIndex) ? startIndex : 0;
    CONFIG.rename.output.template = CONFIG.rename.template;

    CONFIG.duplicate.mode = 'numbers';
    CONFIG.duplicate.numbers = (UI.fields.duplicateNumbers?.value || DEFAULT_DUPLICATE_NUMBERS).trim() || DEFAULT_DUPLICATE_NUMBERS;
    CONFIG.duplicate.pattern = buildDuplicatePatternFromNumbers(CONFIG.duplicate.numbers);
    CONFIG.duplicate.flags = 'u';

    const cloudBatchLimit = Number(UI.fields.cloudBatchLimit?.value || 500);
    CONFIG.cloud.maxFilesPerTask = Number.isFinite(cloudBatchLimit) && cloudBatchLimit > 0 ? Math.max(1, cloudBatchLimit) : 500;
    CONFIG.cloud.sourceDirPrefix = (UI.fields.cloudDirPrefix?.value || '磁力导入').trim() || '磁力导入';
    CONFIG.move.targetParentId = (UI.fields.moveTargetParentId?.value || '').trim();

    const delayMs = Number(UI.fields.delayMs?.value || 300);
    CONFIG.batch.delayMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 300;

    savePersistedConfig();
    updatePanelStatus('配置已应用');
    updateRenameModePreview();
  }

  function fillPanelFromCaptured() {
    if (!UI.root) {
      return;
    }

    const context = getCurrentListContext();
    if (UI.fields.did && STATE.headers.did) {
      UI.fields.did.value = STATE.headers.did;
    }
    if (UI.fields.dt && STATE.headers.dt) {
      UI.fields.dt.value = STATE.headers.dt;
    }
    if (UI.fields.parentId && context.parentId) {
      UI.fields.parentId.value = context.parentId;
    }
    if (UI.fields.pageSize && context.pageSize) {
      UI.fields.pageSize.value = String(context.pageSize);
    }

    if (UI.fields.authorization) {
      UI.fields.authorization.value =
        STATE.headers.authorization || CONFIG.request.manualHeaders.authorization || UI.fields.authorization.value || '';
    }

    updatePanelStatus('已把可见上下文填入表单');
    updateRenameModePreview();
  }

  function setPanelBusy(busy) {
    if (!UI.root) {
      return;
    }
    UI.root.querySelectorAll('button, input, textarea, select').forEach((el) => {
      if (el.dataset.keepEnabled === 'true') {
        return;
      }
      el.disabled = busy;
    });
  }

  function createPanel() {
    if (UI.root || !document.body) {
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #gyp-batch-rename-root {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #172033;
        width: 64px;
        height: 64px;
      }
      #gyp-batch-rename-root .gyp-fab {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 62px;
        height: 62px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at 30% 30%, #ffffff 0%, #edf5ff 100%);
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 16px 34px rgba(15, 98, 254, 0.24);
        overflow: hidden;
        user-select: none;
        transition: transform 0.18s ease, box-shadow 0.18s ease;
      }
      #gyp-batch-rename-root .gyp-fab:hover {
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 20px 40px rgba(15, 98, 254, 0.3);
      }
      #gyp-batch-rename-root .gyp-fab:active {
        transform: scale(0.98);
      }
      #gyp-batch-rename-root .gyp-fab-icon {
        width: 78%;
        height: 78%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #gyp-batch-rename-root .gyp-fab svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      #gyp-batch-rename-root .gyp-panel {
        position: absolute;
        right: 0;
        bottom: 72px;
        width: min(468px, calc(100vw - 24px));
        max-height: min(76vh, 760px);
        overflow-x: hidden;
        overflow-y: auto;
        padding: 14px;
        box-sizing: border-box;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
        backdrop-filter: blur(12px);
        opacity: 0;
        transform: translateY(8px) scale(0.98);
        transform-origin: bottom right;
        pointer-events: none;
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      #gyp-batch-rename-root.gyp-open .gyp-panel {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      #gyp-batch-rename-root .gyp-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 10px;
        gap: 10px;
      }
      #gyp-batch-rename-root .gyp-head > div:first-child {
        min-width: 0;
        flex: 1 1 260px;
      }
      #gyp-batch-rename-root .gyp-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      #gyp-batch-rename-root .gyp-title-mark {
        width: 28px;
        height: 28px;
        flex: 0 0 auto;
        object-fit: contain;
        border-radius: 8px;
      }
      #gyp-batch-rename-root .gyp-title-stack {
        min-width: 0;
      }
      #gyp-batch-rename-root .gyp-title {
        font-size: 14px;
        font-weight: 700;
      }
      #gyp-batch-rename-root .gyp-subtitle {
        margin-top: 2px;
        font-size: 11px;
        color: #667085;
      }
      #gyp-batch-rename-root .gyp-version {
        margin-top: 2px;
        font-size: 11px;
        color: #0f62fe;
        font-weight: 600;
      }
      #gyp-batch-rename-root .gyp-head button,
      #gyp-batch-rename-root .gyp-actions button,
      #gyp-batch-rename-root .gyp-section-actions button,
      #gyp-batch-rename-root .gyp-config-actions button {
        border: 0;
        border-radius: 10px;
        background: #0f62fe;
        color: #fff;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 12px;
      }
      #gyp-batch-rename-root .gyp-head button {
        padding: 7px 10px;
        white-space: nowrap;
      }
      #gyp-batch-rename-root .gyp-head button.secondary,
      #gyp-batch-rename-root .gyp-actions button.secondary,
      #gyp-batch-rename-root .gyp-section-actions button.secondary,
      #gyp-batch-rename-root .gyp-config-actions button.secondary {
        background: #eef2ff;
        color: #1f2a44;
      }
      #gyp-batch-rename-root .gyp-head button.danger,
      #gyp-batch-rename-root .gyp-actions button.danger,
      #gyp-batch-rename-root .gyp-section-actions button.danger,
      #gyp-batch-rename-root .gyp-config-actions button.danger {
        background: #d92d20;
        color: #fff;
      }
      #gyp-batch-rename-root .gyp-status {
        margin-bottom: 10px;
        padding: 10px;
        border-radius: 10px;
        background: #f5f8ff;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-progress {
        display: none;
        margin-bottom: 10px;
        padding: 10px;
        border-radius: 10px;
        background: #eef4ff;
      }
      #gyp-batch-rename-root .gyp-progress-track {
        height: 10px;
        border-radius: 999px;
        background: rgba(15, 98, 254, 0.12);
        overflow: hidden;
      }
      #gyp-batch-rename-root .gyp-progress-bar {
        width: 0%;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #0f62fe, #45a1ff);
        transition: width 0.2s ease;
      }
      #gyp-batch-rename-root .gyp-progress-bar.gyp-indeterminate {
        background: linear-gradient(90deg, #0f62fe 0%, #69baff 48%, #0f62fe 100%);
        animation: gyp-progress-indeterminate 1.15s ease-in-out infinite;
        will-change: transform;
      }
      #gyp-batch-rename-root .gyp-progress-text {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.5;
        color: #26437a;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-progress-tools {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
      #gyp-batch-rename-root .gyp-progress-tools button {
        flex: 1 1 0;
        font-weight: 700;
        border: 1px solid transparent;
        border-radius: 14px;
        min-height: 42px;
        padding: 10px 12px;
      }
      #gyp-batch-rename-root .gyp-progress-tools button.secondary {
        background: #facc15;
        color: #422006;
        border-color: #eab308;
      }
      #gyp-batch-rename-root .gyp-progress-tools button.secondary:hover:not(:disabled) {
        background: #eab308;
      }
      #gyp-batch-rename-root .gyp-progress-tools button.danger {
        background: #dc2626;
        color: #fff;
        border-color: #b91c1c;
      }
      #gyp-batch-rename-root .gyp-progress-tools button.danger:hover:not(:disabled) {
        background: #b91c1c;
      }
      #gyp-batch-rename-root .gyp-progress-tools button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      @keyframes gyp-progress-indeterminate {
        0% {
          transform: translateX(-130%);
        }
        100% {
          transform: translateX(260%);
        }
      }
      #gyp-batch-rename-root .gyp-actions,
      #gyp-batch-rename-root .gyp-config-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }
      #gyp-batch-rename-root .gyp-sections {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 10px;
      }
      #gyp-batch-rename-root .gyp-section {
        margin: 0;
      }
      #gyp-batch-rename-root .gyp-section > summary {
        list-style: none;
      }
      #gyp-batch-rename-root .gyp-section > summary::-webkit-details-marker {
        display: none;
      }
      #gyp-batch-rename-root .gyp-section-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      #gyp-batch-rename-root .gyp-section-headline {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      #gyp-batch-rename-root .gyp-section-title-line {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      #gyp-batch-rename-root .gyp-section-icon {
        flex: 0 0 auto;
        font-size: 16px;
        line-height: 1;
      }
      #gyp-batch-rename-root .gyp-section-title {
        font-size: 13px;
        font-weight: 700;
        color: #22324d;
      }
      #gyp-batch-rename-root .gyp-section-desc {
        font-size: 11px;
        line-height: 1.45;
        color: #667085;
      }
      #gyp-batch-rename-root .gyp-section-badge {
        flex: 0 0 auto;
        padding: 4px 8px;
        border-radius: 999px;
        background: #eef4ff;
        color: #26437a;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      #gyp-batch-rename-root .gyp-section-body {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #gyp-batch-rename-root .gyp-section-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      #gyp-batch-rename-root .gyp-section-actions button {
        flex: 1 1 calc(50% - 4px);
      }
      #gyp-batch-rename-root .gyp-section-note {
        font-size: 11px;
        line-height: 1.5;
        color: #667085;
      }
      #gyp-batch-rename-root .gyp-actions button {
        flex: 1 1 calc(50% - 4px);
      }
      #gyp-batch-rename-root details {
        margin: 10px 0;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 10px;
        padding: 10px;
        background: #fbfcfe;
      }
      #gyp-batch-rename-root summary {
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
      }
      #gyp-batch-rename-root .gyp-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 10px;
      }
      #gyp-batch-rename-root .gyp-field span {
        font-size: 12px;
        color: #344054;
      }
      #gyp-batch-rename-root .gyp-field input,
      #gyp-batch-rename-root .gyp-field select,
      #gyp-batch-rename-root .gyp-field textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        color: #172033;
        background: #fff;
      }
      #gyp-batch-rename-root .gyp-field textarea {
        min-height: 58px;
        resize: vertical;
      }
      #gyp-batch-rename-root .gyp-inline-help {
        font-size: 11px;
        line-height: 1.5;
        color: #667085;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-example {
        margin-top: 10px;
        padding: 10px;
        border-radius: 12px;
        background: #f7faff;
        border: 1px solid rgba(15, 98, 254, 0.12);
      }
      #gyp-batch-rename-root .gyp-example-title {
        font-size: 12px;
        font-weight: 700;
        color: #22324d;
        margin-bottom: 8px;
      }
      #gyp-batch-rename-root .gyp-example-row {
        margin-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #gyp-batch-rename-root .gyp-example-label {
        font-size: 11px;
        color: #667085;
      }
      #gyp-batch-rename-root .gyp-example-value {
        font-size: 12px;
        line-height: 1.5;
        color: #172033;
        padding: 8px 10px;
        border-radius: 8px;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-advanced {
        margin-top: 12px;
        border-top: 1px dashed rgba(15, 23, 42, 0.12);
        padding-top: 10px;
      }
      #gyp-batch-rename-root .gyp-advanced-title {
        font-size: 12px;
        font-weight: 600;
        color: #344054;
      }
      #gyp-batch-rename-root .gyp-help,
      #gyp-batch-rename-root .gyp-summary {
        font-size: 12px;
        line-height: 1.5;
        color: #475467;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-summary {
        padding: 10px;
        border-radius: 10px;
        background: #fff7ed;
        margin-top: 10px;
      }
      #gyp-batch-rename-root .gyp-debug-details {
        margin-top: 8px;
        border: 1px dashed rgba(15, 23, 42, 0.12);
        border-radius: 10px;
        padding: 8px 10px;
        background: #fcfcfd;
      }
      #gyp-batch-rename-root .gyp-debug-details > summary {
        font-size: 12px;
        font-weight: 600;
        color: #667085;
      }
      #gyp-batch-rename-root .gyp-debug-details .gyp-summary {
        margin-top: 8px;
        margin-bottom: 0;
      }
      #gyp-batch-rename-root .gyp-duplicate-panel {
        margin-bottom: 0;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 12px;
        background: #f9fbff;
        padding: 10px;
      }
      #gyp-batch-rename-root .gyp-duplicate-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      #gyp-batch-rename-root .gyp-duplicate-title {
        font-size: 12px;
        font-weight: 700;
        color: #22324d;
      }
      #gyp-batch-rename-root .gyp-duplicate-tools {
        display: flex;
        gap: 6px;
      }
      #gyp-batch-rename-root .gyp-duplicate-tools button {
        border: 0;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 11px;
        background: #eef2ff;
        color: #22324d;
        cursor: pointer;
      }
      #gyp-batch-rename-root .gyp-duplicate-list {
        max-height: 180px;
        overflow-x: hidden;
        overflow-y: auto;
        border-radius: 10px;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
      }
      #gyp-batch-rename-root .gyp-duplicate-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        cursor: pointer;
      }
      #gyp-batch-rename-root .gyp-duplicate-row:last-child {
        border-bottom: 0;
      }
      #gyp-batch-rename-root .gyp-duplicate-row input {
        margin-top: 2px;
        flex: 0 0 auto;
      }
      #gyp-batch-rename-root .gyp-duplicate-name {
        font-size: 12px;
        line-height: 1.45;
        color: #23314b;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-duplicate-empty {
        padding: 12px 10px;
        font-size: 12px;
        line-height: 1.5;
        color: #667085;
      }
      #gyp-batch-rename-root .gyp-import-details {
        margin-top: 0;
      }
      #gyp-batch-rename-root .gyp-import-summary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        color: #22324d;
      }
      #gyp-batch-rename-root .gyp-import-list {
        margin-top: 10px;
        max-height: 140px;
        overflow-x: hidden;
        overflow-y: auto;
        border-radius: 10px;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
      }
      #gyp-batch-rename-root .gyp-import-row {
        padding: 8px 10px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.06);
      }
      #gyp-batch-rename-root .gyp-import-row:last-child {
        border-bottom: 0;
      }
      #gyp-batch-rename-root .gyp-import-name {
        font-size: 12px;
        line-height: 1.45;
        color: #23314b;
        font-weight: 600;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-import-meta,
      #gyp-batch-rename-root .gyp-import-empty {
        margin-top: 4px;
        font-size: 11px;
        line-height: 1.5;
        color: #667085;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-import-empty {
        padding: 12px 10px;
        margin-top: 0;
      }
      #gyp-batch-rename-root .gyp-empty-dir-list {
        max-height: 280px;
      }
      #gyp-batch-rename-root .gyp-empty-dir-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        cursor: pointer;
      }
      #gyp-batch-rename-root .gyp-empty-dir-row:last-child {
        border-bottom: 0;
      }
      #gyp-batch-rename-root .gyp-empty-dir-row input {
        margin-top: 2px;
        flex: 0 0 auto;
      }
      #gyp-batch-rename-root .gyp-empty-dir-main {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #gyp-batch-rename-root .gyp-empty-dir-path {
        font-size: 12px;
        line-height: 1.5;
        color: #23314b;
        font-weight: 600;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-empty-dir-meta {
        font-size: 11px;
        line-height: 1.55;
        color: #667085;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      #gyp-batch-rename-root .gyp-empty-dir-row[data-confidence="likely"] .gyp-empty-dir-meta {
        color: #b54708;
      }
      /* 增强输入框聚焦时的蓝色高亮 */
      #gyp-batch-rename-root .gyp-field input:focus,
      #gyp-batch-rename-root .gyp-field select:focus,
        #gyp-batch-rename-root .gyp-field textarea:focus {
        outline: none;
        border-color: #0f62fe !important;
        box-shadow: 0 0 0 3px rgba(15, 98, 254, 0.2) !important;
        background: #fff;
      }
      /* 悬停效果 */
      #gyp-batch-rename-root .gyp-field input:hover,
      #gyp-batch-rename-root .gyp-field select:hover {
        border-color: #0f62fe;
      }
      /* 修复：强制显示文字选中后的高亮颜色 */
      #gyp-batch-rename-root input::selection,
      #gyp-batch-rename-root textarea::selection {
        background-color: #0078d4 !important;
        color: #ffffff !important;
      }
      /* 针对不同浏览器的兼容 */
      #gyp-batch-rename-root input::-moz-selection,
      #gyp-batch-rename-root textarea::-moz-selection {
        background-color: #0078d4 !important;
        color: #ffffff !important;
      }
      /* 让下拉列表在悬停时也有反应 */
      #gyp-batch-rename-root .gyp-field select:hover,
      #gyp-batch-rename-root .gyp-field input:hover {
        border-color: #0f62fe;
      }
      @media (max-width: 640px) {
        #gyp-batch-rename-root {
          right: 10px;
          bottom: 10px;
        }
        #gyp-batch-rename-root .gyp-panel {
          width: min(380px, calc(100vw - 20px));
          max-height: 72vh;
        }
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'gyp-batch-rename-root';
    root.innerHTML = `
      <button
        type="button"
        class="gyp-fab"
        data-action="toggle-panel"
        data-keep-enabled="true"
        title="光鸭云盘工具"
        aria-label="光鸭云盘工具"
      >
        <span class="gyp-fab-icon" aria-hidden="true">
        <svg class="icon" viewBox="0 0 904.6 870.7" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
<style type="text/css">
	.st0{fill:#B0B0B0;}
	.st1{fill:#F6B2B1;}
	.st2{fill:#FFC41D;}
	.st3{fill:#333333;}
	.st4{fill:#FFFFFF;}
	.st5{fill:none;stroke:#333333;stroke-width:12;stroke-linecap:round;}
	.st6{stroke:#666666;stroke-width:15;stroke-linecap:round;}
	.st7{fill:none;}
</style>
<path class="st0" d="M335.2,23.7c-56.3,0-102.4,97.3-102.4,215s46.1,215,102.4,215s102.4-97.3,102.4-215S391.5,23.7,335.2,23.7z"/>
<path class="st1" d="M335.2,74.9c-35.8,0-66.6,61.4-66.6,138.2s30.7,138.2,66.6,138.2s66.6-61.4,66.6-138.2S371,74.9,335.2,74.9
	L335.2,74.9z"/>
<path class="st0" d="M609,38.7c56.3,0,102.4,97.3,102.4,215s-46.1,215-102.4,215s-102.4-97.3-102.4-215S552.7,38.7,609,38.7z"/>
<path class="st1" d="M609,89.9c35.8,0,66.6,61.4,66.6,138.2S644.8,366.4,609,366.4s-66.6-61.4-66.6-138.2S573.2,89.9,609,89.9
	L609,89.9z"/>
<path class="st0" d="M535.5,305.3c161.3,0,291.8,130.6,291.8,291.8v66.6C827.4,766.1,745.4,848,643,848H228.2
	c-102.4,0-184.3-81.9-184.3-184.3v-66.6c0-161.3,130.6-291.8,291.8-291.8h200H535.5z"/>
<path class="st2" d="M50.5,318.9L34.8,309c-8.8-5.5-8.8-18.4,0-23.9l15.7-9.9c10.3-6.5,18.3-14.5,24.8-24.8l9.9-15.7
	c5.5-8.8,18.4-8.8,23.9,0l9.9,15.7c6.5,10.3,14.5,18.3,24.8,24.8l15.7,9.9c8.8,5.5,8.8,18.4,0,23.9l-15.7,9.9
	c-10.3,6.5-18.3,14.5-24.8,24.8l-9.9,15.7c-5.5,8.8-18.4,8.8-23.9,0l-9.9-15.7C68.8,333.4,60.8,325.4,50.5,318.9z"/>
<path class="st2" d="M789,331.8l-15.7-9.9c-8.8-5.5-8.8-18.4,0-23.9l15.7-9.9c10.3-6.5,18.3-14.5,24.8-24.8l9.9-15.7
	c5.5-8.8,18.4-8.8,23.9,0l9.9,15.7c6.5,10.3,14.5,18.3,24.8,24.8L898,298c8.8,5.5,8.8,18.4,0,23.9l-15.7,9.9
	c-10.3,6.5-18.3,14.5-24.8,24.8l-9.9,15.7c-5.5,8.8-18.4,8.8-23.9,0l-9.9-15.7C807.3,346.3,799.3,338.3,789,331.8z"/>
<circle class="st3" cx="301.4" cy="429.8" r="44"/>
<circle class="st4" cx="316.4" cy="414.8" r="15"/>
<circle class="st3" cx="661.4" cy="427.9" r="44"/>
<circle class="st4" cx="646.4" cy="412.9" r="15"/>
<circle class="st1" cx="505.6" cy="458.8" r="15"/>
<path class="st5" d="M456.6,491.8c0,13.8,11.2,25,25,25s25-11.2,25-25"/>
<path class="st5" d="M506.6,491.8c0,13.8,11.2,25,25,25s25-11.2,25-25"/>
<path class="st6" d="M32.6,438.8l117,29"/>
<path class="st6" d="M32.6,535.8l117-15"/>
<path class="st6" d="M885.9,405.3l-117,29"/>
<path class="st6" d="M885.9,502.3l-117-15"/>
<circle class="st1" cx="742.4" cy="518.7" r="58"/>
<circle class="st1" cx="198.4" cy="511.8" r="58"/>
<path id="SVGID_x5F_1_x5F_" class="st7" d="M76.7,634.5c0,0-8.7,83.9,17.4,106.8c26.2,22.9,62.1,81.7,129.7,89.4"/>
<text><textPath  xlink:href="#SVGID_x5F_1_x5F_" startOffset="20.6543%">
<tspan  style="fill:#F4F5FB; font-family:'LQSshufaziti'; font-size:48px;">Serenalee</tspan></textPath>
</text>
</svg>
        </span>
      </button>
      <div class="gyp-panel" role="dialog" aria-label="光鸭云盘批量工具">
        <div class="gyp-head">
          <div>
            <div class="gyp-title-row">
              <img class="gyp-title-mark" src="https://image.868717.xyz/file/1776301692011_3.svg" alt="" aria-hidden="true" />
              <div class="gyp-title-stack">
                <div class="gyp-title">光鸭云盘工具</div>
                <div class="gyp-subtitle">批量改名 / 重复项清理 / 空目录扫描 / 磁力云添加</div>
                <div class="gyp-version">Serenalee (v${SCRIPT_VERSION})</div>
              </div>
            </div>
          </div>
          <button type="button" class="secondary" data-action="close-panel" data-keep-enabled="true">关闭</button>
        </div>
        <div class="gyp-status" data-role="status">等待页面捕获目录、授权和请求上下文...</div>
        <div class="gyp-progress" data-role="progress">
          <div class="gyp-progress-track">
            <div class="gyp-progress-bar" data-role="progress-bar"></div>
          </div>
          <div class="gyp-progress-text" data-role="progress-text"></div>
          <div class="gyp-progress-tools">
            <button type="button" class="secondary" data-action="pause-task" data-keep-enabled="true" disabled>暂停</button>
            <button type="button" class="danger" data-action="stop-task" data-keep-enabled="true" disabled>停止</button>
          </div>
        </div>
        <div class="gyp-sections">
          <details class="gyp-section" open>
            <summary>
              <span class="gyp-section-summary">
                <span class="gyp-section-headline">
                  <span class="gyp-section-title-line"><span class="gyp-section-icon" aria-hidden="true">📝</span><span class="gyp-section-title">批量改名</span></span>
                  <span class="gyp-section-desc">预览、执行和规则配置放在一起</span>
                </span>
              </span>
            </summary>
            <div class="gyp-section-body">
              <div class="gyp-section-actions">
                <button type="button" data-action="preview">预览</button>
                <button type="button" class="secondary" data-action="refresh-preview">刷新改名预览</button>
                <button type="button" data-action="run">执行改名</button>
                <button type="button" class="secondary" data-action="state">查看状态</button>
              </div>
              <div class="gyp-section-note">先在下面调整规则，再点“预览”确认结果，最后执行改名。</div>
          <label class="gyp-field">
            <span>预处理</span>
            <select data-field="ruleMode">
              <option value="remove-leading-bracket">删除开头第一个 [] / 【】 段</option>
              <option value="replace-text">按固定文字查找并替换</option>
              <option value="none">不做预处理</option>
              <option value="custom-regex">自定义正则（高级）</option>
            </select>
            <div class="gyp-inline-help">这一步是先把原名字做一次清理。比如删掉开头的 [高清剧集网]，或者删掉某段固定文字。</div>
          </label>
          <label class="gyp-field" data-role="rule-text-group">
            <span>预处理查找文本</span>
            <input data-field="ruleSearchText" placeholder="比如：1080p 或 【无删减版】" />
          </label>
          <label class="gyp-field" data-role="rule-text-group">
            <span>预处理替换成</span>
            <input data-field="ruleReplaceText" placeholder="留空表示删除找到的内容" />
            <div class="gyp-inline-help">如果只想删除一段固定文字，这里直接留空就行。</div>
          </label>
          <label class="gyp-field">
            <span>改名方式</span>
            <select data-field="outputMode">
              <option value="keep-clean">直接使用处理后的名字</option>
              <option value="add-text">增加文字</option>
              <option value="replace-text">替换文字</option>
              <option value="format">格式命名</option>
              <option value="custom-template">自定义模板（高级）</option>
            </select>
            <div class="gyp-inline-help">这里才是最终怎么命名。你想“增加、替换、格式化”，都在这里选。</div>
          </label>
          <label class="gyp-field" data-role="output-add-group">
            <span>增加内容</span>
            <input data-field="addText" placeholder="比如：4K版- 或 -收藏" />
          </label>
          <label class="gyp-field" data-role="output-add-group">
            <span>增加位置</span>
            <select data-field="addPosition">
              <option value="prefix">名称之前</option>
              <option value="suffix">名称之后</option>
            </select>
          </label>
          <label class="gyp-field" data-role="output-replace-group">
            <span>最终查找文本</span>
            <input data-field="outputFindText" placeholder="比如：1" />
          </label>
          <label class="gyp-field" data-role="output-replace-group">
            <span>最终替换成</span>
            <input data-field="outputReplaceText" placeholder="比如：2；留空表示删除" />
          </label>
          <label class="gyp-field" data-role="output-format-group">
            <span>名称格式</span>
            <select data-field="formatStyle">
              <option value="text-and-index">名称和索引</option>
              <option value="text-only">仅自定义名称</option>
            </select>
          </label>
          <label class="gyp-field" data-role="output-format-group">
            <span>自定义格式</span>
            <input data-field="formatText" placeholder="比如：文件" />
          </label>
          <label class="gyp-field" data-role="output-format-group">
            <span>位置</span>
            <select data-field="formatPosition">
              <option value="suffix">名称之后</option>
              <option value="prefix">名称之前</option>
            </select>
          </label>
          <label class="gyp-field" data-role="output-format-group">
            <span>开始数字为</span>
            <input data-field="startIndex" placeholder="0" />
          </label>
          <label class="gyp-field">
            <span>每次请求间隔毫秒</span>
            <input data-field="delayMs" placeholder="300" />
            <div class="gyp-inline-help">默认 300。如果接口容易失败，可以适当调大，比如 500 或 800。</div>
          </label>
          <div class="gyp-example">
            <div class="gyp-example-title">当前规则示例</div>
            <label class="gyp-field">
              <span>示例原名</span>
              <input data-field="exampleName" placeholder="这里填一个例子，下面会实时显示处理结果" />
            </label>
            <div class="gyp-inline-help" data-role="rename-example-desc"></div>
            <div class="gyp-example-row">
              <div class="gyp-example-label">预处理后</div>
              <div class="gyp-example-value" data-role="rename-example-clean"></div>
            </div>
            <div class="gyp-example-row">
              <div class="gyp-example-label">最终改名结果</div>
              <div class="gyp-example-value" data-role="rename-example-final"></div>
            </div>
          </div>
          <div class="gyp-config-actions">
            <button type="button" class="secondary" data-action="apply-config">应用配置</button>
            <button type="button" class="secondary" data-action="save-config">保存配置</button>
          </div>
          <div class="gyp-help">说明：
1. “预处理”是先把原名字清理一下，比如删掉开头的 []、删掉某段固定文字
2. “改名方式”才是最终要怎么命名，可选增加、替换、格式命名
3. 现在的“最终名字格式”其实就是以前的高级模板概念，已经放到高级区里了
4. 每次填完都看上面的示例，确认结果对了，再点“预览”或“执行改名”</div>
            </div>
          </details>
          <details class="gyp-section" data-role="duplicate-details">
            <summary>
              <span class="gyp-section-summary">
                <span class="gyp-section-headline">
                  <span class="gyp-section-title-line"><span class="gyp-section-icon" aria-hidden="true">♻️</span><span class="gyp-section-title">重复项清理</span></span>
                  <span class="gyp-section-desc">预览、勾选、取消和删除在同一区</span>
                </span>
                <span class="gyp-section-badge" data-role="duplicate-count">删除勾选 0/0</span>
              </span>
            </summary>
            <div class="gyp-section-body">
              <div class="gyp-section-actions">
                <button type="button" class="secondary" data-action="preview-duplicates">重复项预览</button>
                <button type="button" class="secondary" data-action="select-duplicates">勾选重复项</button>
                <button type="button" class="danger" data-action="delete-duplicates">删除重复项</button>
              </div>
              <label class="gyp-field">
                <span>重复项编号</span>
                <input data-field="duplicateNumbers" placeholder="1,2,3" />
                <div class="gyp-inline-help">这里只影响重复项识别规则。只要名字最后带 (1)、(2)、(3) 就算重复；想加 4 就写 1,2,3,4。</div>
              </label>
              <div class="gyp-duplicate-panel">
                <div class="gyp-duplicate-head">
                  <div class="gyp-duplicate-title">重复项列表</div>
                  <div class="gyp-duplicate-tools">
                    <button type="button" data-action="select-all-duplicates">全选</button>
                    <button type="button" data-action="clear-all-duplicates">全不选</button>
                  </div>
                </div>
                <div class="gyp-duplicate-list" data-role="duplicate-list">
                  <div class="gyp-duplicate-empty">先点“重复项预览”，再在这里取消不想删的项目。</div>
                </div>
              </div>
            </div>
          </details>
          <details class="gyp-section" data-role="empty-dir-details">
            <summary>
              <span class="gyp-section-summary">
                <span class="gyp-section-headline">
                  <span class="gyp-section-title-line"><span class="gyp-section-icon" aria-hidden="true">📂</span><span class="gyp-section-title">空目录扫描</span></span>
                  <span class="gyp-section-desc">扫描结果和删除勾选都放在这里</span>
                </span>
                <span class="gyp-section-badge" data-role="empty-dir-count">空目录 0 个</span>
              </span>
            </summary>
            <div class="gyp-section-body">
              <div class="gyp-section-actions">
                <button type="button" class="secondary" data-action="scan-empty-dirs">扫描空目录</button>
              </div>
              <div class="gyp-duplicate-panel">
                <div class="gyp-duplicate-head">
                  <div class="gyp-duplicate-title">空目录结果</div>
                  <div class="gyp-duplicate-tools">
                    <button type="button" data-action="select-all-empty-dirs">全选</button>
                    <button type="button" data-action="clear-all-empty-dirs">全不选</button>
                    <button type="button" data-action="delete-empty-dirs">删除空目录</button>
                  </div>
                </div>
                <div class="gyp-import-list gyp-empty-dir-list" data-role="empty-dir-list">
                  <div class="gyp-import-empty">点“扫描空目录”后，这里会列出当前目录树里最里层且完全空的目录。</div>
                </div>
              </div>
            </div>
          </details>
          <details class="gyp-section" data-role="move-details">
            <summary>
              <span class="gyp-section-summary">
                <span class="gyp-section-headline">
                  <span class="gyp-section-title-line"><span class="gyp-section-icon" aria-hidden="true">📦</span><span class="gyp-section-title">移动整理</span></span>
                  <span class="gyp-section-desc">基于当前页面已勾选项做移动，不是面板里的勾选</span>
                </span>
                <span class="gyp-section-badge" data-role="move-count">当前勾选 0 项</span>
              </span>
            </summary>
            <div class="gyp-section-body">
              <div class="gyp-section-actions">
                <button type="button" class="secondary" data-action="preview-move-selection">读取当前勾选</button>
                <button type="button" class="secondary" data-action="move-selected-up-one-level">勾选项整体上移一层</button>
                <button type="button" class="secondary" data-action="move-folder-contents-up">拆开文件夹内容到当前目录</button>
                <button type="button" class="secondary" data-action="move-selected-to-target">勾选项移到目标目录</button>
              </div>
              <div class="gyp-section-note">这里读取的是云盘文件列表里当前页面已经勾选的文件 / 文件夹。“勾选项整体上移一层”会保留文件夹本身；“拆开文件夹内容到当前目录”会把文件夹里的直接内容提到当前目录，不保留外层文件夹，也不会自动删除空文件夹。</div>
              <label class="gyp-field">
                <span>目标目录 parentId</span>
                <input data-field="moveTargetParentId" placeholder="要移动到哪个文件夹，就填那个目录的 parentId" />
                <div class="gyp-inline-help">“勾选项移到目标目录”会把当前页面已勾选的文件 / 文件夹直接移动到这里。这个值会保存在本地。</div>
              </label>
              <div class="gyp-import-list" data-role="move-selection-list">
                <div class="gyp-import-empty">点“读取当前勾选”后，这里会显示当前页面已勾选的文件 / 文件夹。</div>
              </div>
            </div>
          </details>
          <details class="gyp-section" data-role="magnet-details">
            <summary>
              <span class="gyp-section-summary">
                <span class="gyp-section-headline">
                  <span class="gyp-section-title-line"><span class="gyp-section-icon" aria-hidden="true">🧲</span><span class="gyp-section-title">磁力云添加</span></span>
                  <span class="gyp-section-desc">文件选择、上传入口和磁力列表都放在一起</span>
                </span>
                <span class="gyp-section-badge" data-role="magnet-file-count">磁力文本 0 个 / 磁力 0 条</span>
              </span>
            </summary>
            <div class="gyp-section-body">
              <div class="gyp-section-actions">
                <button type="button" class="secondary" data-action="pick-magnet-files" data-keep-enabled="true">选择TXT/JSON</button>
                <button type="button" class="secondary" data-action="clear-magnet-files">清空磁力TXT</button>
                <button type="button" class="secondary" data-action="import-magnets">开始云添加</button>
                <button type="button" class="secondary" data-action="list-cloud-tasks">查看云任务</button>
              </div>
              <label class="gyp-field">
                <span>云添加每批最多文件数</span>
                <input data-field="cloudBatchLimit" placeholder="500" />
                <div class="gyp-inline-help">这里只影响云添加的拆批数量。试用版常见限制是一次最多 500 个文件，脚本会按这里的值自动拆分 create_task。</div>
              </label>
              <label class="gyp-field">
                <span>云添加目录前缀</span>
                <input data-field="cloudDirPrefix" placeholder="磁力导入" />
                <div class="gyp-inline-help">这里只影响云添加时自动创建的目录名。导入本地 txt/json 后，会建立“前缀-文本名-时间戳”文件夹，避免和现有内容混在一起。</div>
              </label>
              <div class="gyp-import-list" data-role="magnet-file-list">
                <div class="gyp-import-empty">选择包含 magnet 链接的 txt 或 json 文件后，脚本会自动识别并按每批 500 文件拆分云添加。</div>
              </div>
              <input type="file" accept=".txt,.json,.log,.text,.md" multiple hidden data-role="magnet-file-input" data-keep-enabled="true" />
            </div>
          </details>
          <details class="gyp-section" data-role="advanced-details">
            <summary>
              <span class="gyp-section-summary">
                <span class="gyp-section-headline">
                  <span class="gyp-section-title-line"><span class="gyp-section-icon" aria-hidden="true">🛠️</span><span class="gyp-section-title">高级与调试</span></span>
                  <span class="gyp-section-desc">手动认证、模板/正则兜底和调试信息都放在最后</span>
                </span>
              </span>
            </summary>
            <div class="gyp-section-body">
              <div class="gyp-section-note">脚本默认优先使用刚刚自动捕获到的认证和目录上下文。只有自动抓不到，或者你要用自定义模板 / 自定义正则时，再展开这里。</div>
              <div class="gyp-config-actions">
                <button type="button" class="secondary" data-action="fill-captured">刷新已捕获上下文</button>
              </div>
              <label class="gyp-field">
                <span>Authorization</span>
                <textarea data-field="authorization" placeholder="默认优先用最新自动识别；只有自动抓不到时才手填 Bearer ..."></textarea>
              </label>
              <label class="gyp-field">
                <span>DID</span>
                <input data-field="did" placeholder="默认自动识别；抓不到时再填" />
              </label>
              <label class="gyp-field">
                <span>DT</span>
                <input data-field="dt" placeholder="默认自动识别；抓不到时再填" />
              </label>
              <label class="gyp-field">
                <span>parentId</span>
                <input data-field="parentId" placeholder="当前目录 ID，平时自动识别；抓不到时再填" />
              </label>
              <label class="gyp-field">
                <span>接口单次抓取数（兜底）</span>
                <input data-field="pageSize" placeholder="默认 100；只有自动识别不到时才需要改" />
              </label>
              <label class="gyp-field">
                <span>高级模板 template</span>
                <input data-field="template" placeholder="比如：{clean} / {original} / 文件{index}" />
                <div class="gyp-inline-help" data-role="output-template-group">只有“改名方式”选了“自定义模板（高级）”时才会用到这里。</div>
              </label>
              <label class="gyp-field">
                <span>规则正则 pattern</span>
                <input data-field="rulePattern" placeholder="只有在“预处理 = 自定义正则”时才需要填" />
              </label>
              <label class="gyp-field">
                <span>规则 flags</span>
                <input data-field="ruleFlags" placeholder="一般是 u" />
              </label>
              <label class="gyp-field">
                <span>替换成 replace</span>
                <input data-field="ruleReplace" placeholder="留空表示删除匹配到的内容" />
              </label>
              <details class="gyp-debug-details">
                <summary>调试信息（一般不用）</summary>
                <div class="gyp-summary" data-role="summary"></div>
              </details>
            </div>
          </details>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    UI.root = root;
    UI.panel = root.querySelector('.gyp-panel');
    UI.mini = root.querySelector('.gyp-fab');
    UI.status = root.querySelector('[data-role="status"]');
    UI.progressWrap = root.querySelector('[data-role="progress"]');
    UI.progressBar = root.querySelector('[data-role="progress-bar"]');
    UI.progressText = root.querySelector('[data-role="progress-text"]');
    UI.pauseTaskButton = root.querySelector('[data-action="pause-task"]');
    UI.stopTaskButton = root.querySelector('[data-action="stop-task"]');
    UI.summary = root.querySelector('[data-role="summary"]');
    UI.duplicateDetails = root.querySelector('[data-role="duplicate-details"]');
    UI.duplicateList = root.querySelector('[data-role="duplicate-list"]');
    UI.duplicateCount = root.querySelector('[data-role="duplicate-count"]');
    UI.moveDetails = root.querySelector('[data-role="move-details"]');
    UI.moveSelectionList = root.querySelector('[data-role="move-selection-list"]');
    UI.moveSelectionCount = root.querySelector('[data-role="move-count"]');
    UI.emptyDirList = root.querySelector('[data-role="empty-dir-list"]');
    UI.emptyDirCount = root.querySelector('[data-role="empty-dir-count"]');
    UI.emptyDirDetails = root.querySelector('[data-role="empty-dir-details"]');
    UI.magnetDetails = root.querySelector('[data-role="magnet-details"]');
    UI.magnetFileInput = root.querySelector('[data-role="magnet-file-input"]');
    UI.magnetFileList = root.querySelector('[data-role="magnet-file-list"]');
    UI.magnetFileCount = root.querySelector('[data-role="magnet-file-count"]');
    UI.fields.ruleMode = root.querySelector('[data-field="ruleMode"]');
    UI.fields.outputMode = root.querySelector('[data-field="outputMode"]');
    UI.fields.ruleSearchText = root.querySelector('[data-field="ruleSearchText"]');
    UI.fields.ruleReplaceText = root.querySelector('[data-field="ruleReplaceText"]');
    UI.fields.addText = root.querySelector('[data-field="addText"]');
    UI.fields.addPosition = root.querySelector('[data-field="addPosition"]');
    UI.fields.outputFindText = root.querySelector('[data-field="outputFindText"]');
    UI.fields.outputReplaceText = root.querySelector('[data-field="outputReplaceText"]');
    UI.fields.formatStyle = root.querySelector('[data-field="formatStyle"]');
    UI.fields.formatText = root.querySelector('[data-field="formatText"]');
    UI.fields.formatPosition = root.querySelector('[data-field="formatPosition"]');
    UI.fields.startIndex = root.querySelector('[data-field="startIndex"]');
    UI.fields.exampleName = root.querySelector('[data-field="exampleName"]');
    UI.fields.authorization = root.querySelector('[data-field="authorization"]');
    UI.fields.did = root.querySelector('[data-field="did"]');
    UI.fields.dt = root.querySelector('[data-field="dt"]');
    UI.fields.parentId = root.querySelector('[data-field="parentId"]');
    UI.fields.pageSize = root.querySelector('[data-field="pageSize"]');
    UI.fields.template = root.querySelector('[data-field="template"]');
    UI.fields.duplicateNumbers = root.querySelector('[data-field="duplicateNumbers"]');
    UI.fields.cloudBatchLimit = root.querySelector('[data-field="cloudBatchLimit"]');
    UI.fields.cloudDirPrefix = root.querySelector('[data-field="cloudDirPrefix"]');
    UI.fields.moveTargetParentId = root.querySelector('[data-field="moveTargetParentId"]');
    UI.fields.rulePattern = root.querySelector('[data-field="rulePattern"]');
    UI.fields.ruleFlags = root.querySelector('[data-field="ruleFlags"]');
    UI.fields.ruleReplace = root.querySelector('[data-field="ruleReplace"]');
    UI.fields.delayMs = root.querySelector('[data-field="delayMs"]');

    const closePanel = () => {
      root.classList.remove('gyp-open');
    };

    const openPanel = () => {
      root.classList.add('gyp-open');
      syncPanelFromConfig();
      updatePanelStatus();
      updateRenameModePreview();
    };

    root.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) {
        return;
      }

      const action = btn.dataset.action;

      if (action === 'pause-task') {
        togglePauseActiveTask();
        return;
      }

      if (action === 'stop-task') {
        stopActiveTask();
        return;
      }

      if (action === 'toggle-panel') {
        if (root.classList.contains('gyp-open')) {
          closePanel();
        } else {
          openPanel();
        }
        return;
      }

      if (action === 'close-panel') {
        closePanel();
        return;
      }

      try {
        if (action === 'pick-magnet-files') {
          if (UI.magnetDetails) {
            UI.magnetDetails.open = true;
          }
          UI.magnetFileInput?.click();
          return;
        }

        if (action === 'clear-magnet-files') {
          STATE.magnetImportFiles = [];
          STATE.lastCloudImportSummary = null;
          if (UI.magnetFileInput) {
            UI.magnetFileInput.value = '';
          }
          renderMagnetImportList();
          updatePanelStatus('已清空待导入的磁力 txt 列表');
          return;
        }

        if (action === 'fill-captured') {
          fillPanelFromCaptured();
          return;
        }

        if (action === 'apply-config') {
          applyPanelConfig();
          return;
        }

        if (action === 'save-config') {
          applyPanelConfig();
          savePersistedConfig();
          updatePanelStatus('配置已保存到本地');
          return;
        }

        if (action === 'select-all-duplicates') {
          for (const item of STATE.duplicatePreviewItems || []) {
            STATE.duplicateSelection[item.fileId] = true;
          }
          renderDuplicatePreviewList();
          updatePanelStatus('已全选当前面板里的重复项');
          return;
        }

        if (action === 'clear-all-duplicates') {
          for (const item of STATE.duplicatePreviewItems || []) {
            STATE.duplicateSelection[item.fileId] = false;
          }
          renderDuplicatePreviewList();
          updatePanelStatus('已取消当前面板里的重复项勾选');
          return;
        }

        if (action === 'select-all-empty-dirs') {
          for (const item of STATE.lastEmptyDirScan?.emptyDirs || []) {
            STATE.emptyDirSelection[String(item.fileId || '')] = true;
          }
          renderEmptyDirScanList();
          updatePanelStatus('已全选当前面板里的空目录');
          return;
        }

        if (action === 'clear-all-empty-dirs') {
          for (const item of STATE.lastEmptyDirScan?.emptyDirs || []) {
            STATE.emptyDirSelection[String(item.fileId || '')] = false;
          }
          renderEmptyDirScanList();
          updatePanelStatus('已取消当前面板里的空目录勾选');
          return;
        }

        applyPanelConfig();
        setPanelBusy(true);

        if (action === 'preview') {
          setProgressBar({ visible: false });
          const targets = await preview();
          updatePanelStatus(`预览完成，共 ${targets.length} 个待改名`);
          return;
        }

        if (action === 'refresh-preview') {
          setProgressBar({ visible: false });
          const targets = await preview({ refresh: true });
          updatePanelStatus(`刷新预览完成，共 ${targets.length} 个待改名`);
          return;
        }

        if (action === 'run') {
          await runWithTaskControl('批量改名', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, text: '准备执行...' });
            const result = await run({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(
              result.fail
                ? `执行完成，成功 ${result.ok} 个，失败 ${result.fail} 个，首个错误：${result.firstError || '(未返回详情)'}`
                : `执行完成，成功 ${result.ok} 个，失败 ${result.fail} 个`
            );
          });
          return;
        }

        if (action === 'scan-empty-dirs') {
          if (UI.emptyDirDetails) {
            UI.emptyDirDetails.open = true;
          }
          await runWithTaskControl('扫描空目录', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备扫描当前目录树里的空目录...' });
            const result = await scanEmptyLeafDirectories({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(
              result.truncated
                ? `空目录扫描完成：找到 ${result.emptyDirs.length} 个，已扫 ${result.scannedDirs} 个目录，结果可能未扫全`
                : `空目录扫描完成：找到 ${result.emptyDirs.length} 个，已扫 ${result.scannedDirs} 个目录`
            );
          });
          return;
        }

        if (action === 'delete-empty-dirs') {
          await runWithTaskControl('删除空目录', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备删除空目录...' });
            const result = await deleteEmptyDirItems({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(`空目录删除完成：成功 ${result.deleted} 个，失败 ${result.fail} 个`);
          });
          return;
        }

        if (action === 'preview-duplicates') {
          if (UI.duplicateDetails) {
            UI.duplicateDetails.open = true;
          }
          setProgressBar({ visible: false });
          const duplicates = await previewDuplicates({ refresh: true });
          setDuplicatePreview(duplicates);
          updatePanelStatus(`重复项预览完成，共 ${duplicates.length} 个；当前范围 ${getCapturedItems().length} 条已捕获记录`);
          return;
        }

        if (action === 'select-duplicates') {
          if (UI.duplicateDetails) {
            UI.duplicateDetails.open = true;
          }
          await runWithTaskControl('勾选重复项', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, text: '准备勾选重复项...' });
            const result = await selectDuplicateRows({
              refresh: true,
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(`重复项已处理：匹配 ${result.matched} 个，勾选 ${result.clicked} 个`);
          });
          return;
        }

        if (action === 'delete-duplicates') {
          if (UI.duplicateDetails) {
            UI.duplicateDetails.open = true;
          }
          await runWithTaskControl('删除重复项', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备删除重复项...' });
            const result = await deleteDuplicateItems({
              refresh: true,
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(`重复项删除完成：成功 ${result.deleted} 个，失败 ${result.fail} 个`);
          });
          return;
        }

        if (action === 'import-magnets') {
          if (UI.magnetDetails) {
            UI.magnetDetails.open = true;
          }
          await runWithTaskControl('磁力云添加', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备提交磁力云添加...' });
            const result = await importMagnetTextFiles({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            const firstFailure = result.failures && result.failures[0] ? `；首个失败：${result.failures[0].message}` : '';
            updatePanelStatus(
              `云添加提交完成：磁力成功 ${result.submittedMagnets} 条，跳过 ${result.skippedMagnets} 条，失败 ${result.failedMagnets} 条；任务批次成功 ${result.submittedTaskBatches} 个，失败 ${result.failedTaskBatches} 个${firstFailure}`
            );
            renderMagnetImportList();
          });
          return;
        }

        if (action === 'list-cloud-tasks') {
          if (UI.magnetDetails) {
            UI.magnetDetails.open = true;
          }
          setProgressBar({ visible: true, percent: 25, indeterminate: true, text: '正在读取云添加任务列表...' });
          const response = await listCloudTasks();
          if (!response.ok || !isProbablySuccess(response.payload, response)) {
            throw new Error(getErrorText(response.payload || response.text || `HTTP ${response.status}`));
          }
          const rows = extractCloudTaskRows(response.payload);
          console.table(rows.map((item) => ({
            taskId: item.taskId,
            status: item.status,
            name: item.name,
            url: item.url,
          })));
          setProgressBar({
            visible: true,
            percent: 100,
            indeterminate: false,
            text: `已读取云添加任务 ${rows.length} 条，详情已输出到控制台`,
          });
          updatePanelStatus(`已读取云添加任务 ${rows.length} 条，详情已输出到控制台`);
          return;
        }

        if (action === 'preview-move-selection') {
          if (UI.moveDetails) {
            UI.moveDetails.open = true;
          }
          setProgressBar({ visible: false });
          const selection = await collectCheckedPageSelectionPreviewItems();
          const items = selection.items || [];
          setMoveSelectionPreview(items, selection.meta);
          if (!items.length) {
            updatePanelStatus('当前页面没有勾选任何文件或文件夹');
          } else if (selection.meta?.partial) {
            updatePanelStatus(selection.meta.warning || `页面显示已选 ${selection.meta?.expectedCount || 0} 项，但当前只识别到 ${selection.meta?.visibleCount || items.length} 项`);
          } else {
            updatePanelStatus(selection.meta?.warning || `已读取当前页面勾选 ${Math.max(items.length, Number(selection.meta?.expectedCount || 0))} 项`);
          }
          return;
        }

        if (action === 'move-folder-contents-up') {
          if (UI.moveDetails) {
            UI.moveDetails.open = true;
          }
          await runWithTaskControl('拆开文件夹内容到当前目录', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备读取已勾选文件夹内容...' });
            const result = await moveCheckedFolderContentsToCurrentDirectory({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(
              result.fail
                ? `拆开文件夹内容完成：成功 ${result.ok} 项，失败 ${result.fail} 项；读取文件夹 ${result.folders?.length || 0} 个`
                : `拆开文件夹内容完成：成功 ${result.ok} 项，失败 ${result.fail} 项；读取文件夹 ${result.folders?.length || 0} 个；空文件夹不会自动删除`
            );
          });
          return;
        }

        if (action === 'move-selected-up-one-level') {
          if (UI.moveDetails) {
            UI.moveDetails.open = true;
          }
          await runWithTaskControl('勾选项整体上移一层', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备把当前勾选项整体上移一层...' });
            const result = await moveCheckedItemsUpOneLevel({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(
              result.fail
                ? `勾选项整体上移一层完成：成功 ${result.ok} 项，失败 ${result.fail} 项；目标目录 ${result.targetParentId || '(未识别)'}`
                : `勾选项整体上移一层完成：成功 ${result.ok} 项，失败 ${result.fail} 项；目标目录 ${result.targetParentId || '(未识别)'}`
            );
          });
          return;
        }

        if (action === 'move-selected-to-target') {
          if (UI.moveDetails) {
            UI.moveDetails.open = true;
          }
          await runWithTaskControl('移动勾选项到目标目录', async (taskControl) => {
            setProgressBar({ visible: true, percent: 0, indeterminate: true, text: '准备移动当前勾选项...' });
            const result = await moveCheckedItemsToTargetDirectory({
              onProgress: (state) => setProgressBar(state),
              taskControl,
            });
            updatePanelStatus(
              result.fail
                ? `移动勾选项完成：成功 ${result.ok} 项，失败 ${result.fail} 项；目标目录 ${result.targetParentId || CONFIG.move.targetParentId || '(未识别)'}`
                : `移动勾选项完成：成功 ${result.ok} 项，失败 ${result.fail} 项；目标目录 ${result.targetParentId || CONFIG.move.targetParentId || '(未识别)'}`
            );
          });
          return;
        }

        if (action === 'state') {
          setProgressBar({ visible: false });
          console.log(LOG_PREFIX, exportState());
          updatePanelStatus('状态已输出到控制台');
        }
      } catch (err) {
        if (isTaskAbortError(err)) {
          setProgressBar({ visible: true, percent: 100, indeterminate: false, text: err.message || '已停止当前任务' });
          updatePanelStatus(err.message || '已停止当前任务');
        } else {
          fail('面板操作失败：', err);
          setProgressBar({ visible: true, percent: 100, text: `失败：${err.message || err}` });
          updatePanelStatus(`失败：${err.message || err}`);
        }
      } finally {
        setPanelBusy(false);
      }
    });

    root.addEventListener('input', (event) => {
      if (event.target.closest('[data-field]')) {
        updateRenameModePreview();
      }
    });

    root.addEventListener('change', (event) => {
      if (event.target.closest('[data-field]')) {
        updateRenameModePreview();
      }

      if (event.target === UI.magnetFileInput) {
        const files = Array.from(UI.magnetFileInput?.files || []);
        if (!files.length) {
          return;
        }

        setProgressBar({
          visible: true,
          percent: 0,
          indeterminate: true,
          text: `正在识别 ${files.length} 个本地磁力文本...`,
        });

        readMagnetImportFiles(files, {
          onProgress: (state) => setProgressBar(state),
        })
          .then((entries) => {
            setMagnetImportFiles(entries, { append: true });
            const stats = getSelectedMagnetImportStats();
            setProgressBar({
              visible: true,
              percent: 100,
              indeterminate: false,
              text: `已识别磁力文本 ${stats.fileCount} 个，共 ${stats.magnetCount} 条磁力`,
            });
            updatePanelStatus(`已识别磁力文本 ${stats.fileCount} 个，共 ${stats.magnetCount} 条磁力`);
          })
          .catch((err) => {
            fail('读取磁力文本失败：', err);
            setProgressBar({
              visible: true,
              percent: 100,
              indeterminate: false,
              text: `读取磁力文本失败：${getErrorText(err)}`,
            });
            updatePanelStatus(`读取磁力文本失败：${getErrorText(err)}`);
          })
          .finally(() => {
            if (UI.magnetFileInput) {
              UI.magnetFileInput.value = '';
            }
          });
        return;
      }

      const duplicateInput = event.target.closest('[data-action="toggle-duplicate"]');
      if (duplicateInput) {
        const fileId = duplicateInput.dataset.fileId || '';
        if (!fileId) {
          return;
        }
        STATE.duplicateSelection[fileId] = Boolean(duplicateInput.checked);
        renderDuplicatePreviewList();
        updatePanelStatus('已更新删除勾选清单');
        return;
      }

      const emptyDirInput = event.target.closest('[data-action="toggle-empty-dir"]');
      if (!emptyDirInput) {
        return;
      }
      const emptyDirId = emptyDirInput.dataset.fileId || '';
      if (!emptyDirId) {
        return;
      }
      STATE.emptyDirSelection[emptyDirId] = Boolean(emptyDirInput.checked);
      renderEmptyDirScanList();
      updatePanelStatus('已更新空目录删除勾选清单');
    });

    document.addEventListener('pointerdown', (event) => {
      if (!root.classList.contains('gyp-open')) {
        return;
      }
      if (root.contains(event.target)) {
        return;
      }
      closePanel();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePanel();
      }
    });

    syncPanelFromConfig();
    renderDuplicatePreviewList();
    renderMoveSelectionList();
    renderEmptyDirScanList();
    renderMagnetImportList();
    updateRenameModePreview();
    syncTaskControlUi();
  }

  function mountPanelWhenReady() {
    if (UI.root) {
      return;
    }
    if (document.body) {
      createPanel();
      return;
    }

    const tryMount = () => {
      if (document.body && !UI.root) {
        createPanel();
      }
    };

    document.addEventListener('DOMContentLoaded', tryMount, { once: true });
    window.addEventListener('load', tryMount, { once: true });
    const timer = window.setInterval(() => {
      if (UI.root) {
        window.clearInterval(timer);
        return;
      }
      if (document.body) {
        createPanel();
        window.clearInterval(timer);
      }
    }, 300);
  }

  function handleCapture(detail) {
    if (!detail || typeof detail !== 'object') {
      return;
    }

    const url = String(detail.url || '');
    if (!url.includes(CONFIG.request.apiHost)) {
      return;
    }

    STATE.lastApiHeaders = sanitizeHeaders(detail.headers);
    mergeHeaders(detail.headers);
    const requestBody = safeJsonParse(detail.requestBody);
    const responseBody = safeJsonParse(detail.responseText);

    if (isLikelyListCapture(url, requestBody, responseBody)) {
      STATE.lastListHeaders = sanitizeHeaders(detail.headers);
      STATE.lastListCapturedAt = Date.now();
      if (requestBody && typeof requestBody === 'object') {
        STATE.lastListBody = sanitizeListBody(requestBody);
        STATE.lastCapturedParentId = getParentIdFromListBody(STATE.lastListBody) || STATE.lastCapturedParentId;
      }

      if (responseBody && typeof responseBody === 'object') {
        const items = extractItemsFromPayload(responseBody);
        STATE.lastListUrl = url;
        STATE.lastListResponse = responseBody;
        if (items.length) {
          const merged = mergeCapturedItems(getParentIdFromListBody(requestBody || STATE.lastListBody), items, {
            listUrl: url,
            requestBody: STATE.lastListBody,
          });
          log(`已捕获列表响应：本批 ${items.length} 项，当前目录累计 ${merged.total} 项（共 ${merged.batchCount} 批）。`);
          syncPanelFromConfig({ fillEmptyOnly: true });
          updatePanelStatus(`已累计当前目录 ${merged.total} 项`);
        }
      }
    }

    if (url.includes(CONFIG.request.renamePath) || /\/rename(?:\?|$)/i.test(url)) {
      STATE.lastRenameRequest = {
        url,
        headers: sanitizeHeaders(detail.headers),
        requestBody,
        responseBody,
      };
      updatePanelStatus('已捕获改名请求上下文');
    }
  }

  function injectNetworkHook() {
    const code = `
      (() => {
        if (window.__gypBatchRenameHookInstalled) {
          return;
        }
        window.__gypBatchRenameHookInstalled = true;

        const EVENT_NAME = ${JSON.stringify(CAPTURE_EVENT)};
        const REQUEST_EVENT = ${JSON.stringify(PAGE_REQUEST_EVENT)};
        const RESPONSE_EVENT = ${JSON.stringify(PAGE_RESPONSE_EVENT)};
        const API_HOST = ${JSON.stringify(CONFIG.request.apiHost)};
        const RENAME_PATH = ${JSON.stringify(CONFIG.request.renamePath)};

        const shouldCapture = (url) =>
          typeof url === 'string' &&
          url.includes(API_HOST);

        const normalizeHeaders = (headersLike) => {
          const out = {};
          if (!headersLike) {
            return out;
          }

          if (headersLike instanceof Headers) {
            for (const [key, value] of headersLike.entries()) {
              out[String(key).toLowerCase()] = value;
            }
            return out;
          }

          if (Array.isArray(headersLike)) {
            for (const [key, value] of headersLike) {
              out[String(key).toLowerCase()] = value;
            }
            return out;
          }

          if (typeof headersLike === 'object') {
            for (const [key, value] of Object.entries(headersLike)) {
              out[String(key).toLowerCase()] = value;
            }
          }
          return out;
        };

        const emit = (detail) => {
          window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
        };

        const emitResponse = (detail) => {
          window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }));
        };

        const originalFetch = window.fetch.bind(window);
        const buildNativeRequestOptions = (optionsLike) => {
          const source = optionsLike && typeof optionsLike === 'object' ? optionsLike : {};
          const out = {};
          const stringFields = ['method', 'mode', 'credentials', 'cache', 'redirect', 'referrer', 'referrerPolicy'];

          for (const key of stringFields) {
            if (typeof source[key] === 'string' && source[key]) {
              out[key] = String(source[key]);
            }
          }

          if (typeof source.keepalive === 'boolean') {
            out.keepalive = source.keepalive;
          }

          const headers = normalizeHeaders(source.headers);
          if (Object.keys(headers).length) {
            out.headers = { ...headers };
          }

          if (typeof source.body === 'string') {
            out.body = source.body;
          }

          return out;
        };
        const requestViaXhr = (url, optionsLike) =>
          new Promise((resolve, reject) => {
            const options = buildNativeRequestOptions(optionsLike);
            const xhr = new XMLHttpRequest();

            xhr.open(options.method || 'GET', String(url), true);
            xhr.withCredentials = options.credentials === 'include';
            xhr.timeout = 30000;

            const headers = normalizeHeaders(options.headers);
            for (const [key, value] of Object.entries(headers)) {
              try {
                xhr.setRequestHeader(key, value);
              } catch (err) {
                reject(new Error(\`XHR setRequestHeader failed for \${key}: \${err && err.message ? err.message : err}\`));
                return;
              }
            }

            xhr.onload = () => {
              resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                text: typeof xhr.responseText === 'string' ? xhr.responseText : '',
                via: 'xhr',
              });
            };
            xhr.onerror = () => reject(new Error('XHR network error'));
            xhr.ontimeout = () => reject(new Error('XHR timeout'));
            xhr.send(typeof options.body === 'string' ? options.body : null);
          });

        window.addEventListener(REQUEST_EVENT, async (event) => {
          const detail = event.detail || {};
          if (!detail.requestId || !detail.url) {
            return;
          }

          try {
            const requestUrl = String(detail.url);
            const requestOptions = buildNativeRequestOptions(detail.options);
            try {
              const response = await originalFetch(requestUrl, requestOptions);
              const text = await response.clone().text();
              emitResponse({
                requestId: detail.requestId,
                ok: response.ok,
                status: response.status,
                text,
                via: 'fetch',
              });
              return;
            } catch (fetchErr) {
              try {
                const fallback = await requestViaXhr(requestUrl, requestOptions);
                emitResponse({
                  requestId: detail.requestId,
                  ok: fallback.ok,
                  status: fallback.status,
                  text: fallback.text,
                  via: fallback.via,
                  fallbackFrom: String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr),
                });
                return;
              } catch (xhrErr) {
                emitResponse({
                  requestId: detail.requestId,
                  error: \`fetch failed: \${String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr)} | xhr failed: \${String(xhrErr && xhrErr.message ? xhrErr.message : xhrErr)}\`,
                });
                return;
              }
            }
          } catch (err) {
            emitResponse({
              requestId: detail.requestId,
              error: String(err && err.message ? err.message : err),
            });
          }
        });

        window.fetch = async function patchedFetch(input, init) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const requestHeaders = normalizeHeaders((init && init.headers) || (input && input.headers));
          const requestBody = init && typeof init.body === 'string' ? init.body : '';
          const response = await originalFetch(input, init);

          if (shouldCapture(url)) {
            try {
              const cloned = response.clone();
              const responseText = await cloned.text();
              emit({
                type: 'fetch',
                url,
                headers: requestHeaders,
                requestBody,
                responseText,
                status: response.status,
              });
            } catch (err) {
              emit({
                type: 'fetch',
                url,
                headers: requestHeaders,
                requestBody,
                responseText: '',
                status: response.status,
                captureError: String(err),
              });
            }
          }

          return response;
        };

        const rawOpen = XMLHttpRequest.prototype.open;
        const rawSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        const rawSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
          this.__gypCapture = {
            method,
            url,
            headers: {},
            requestBody: '',
          };
          return rawOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.setRequestHeader = function patchedSetHeader(name, value) {
          if (this.__gypCapture) {
            this.__gypCapture.headers[String(name).toLowerCase()] = value;
          }
          return rawSetHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function patchedSend(body) {
          if (this.__gypCapture && typeof body === 'string') {
            this.__gypCapture.requestBody = body;
          }

          this.addEventListener('load', function onLoad() {
            const url = this.responseURL || (this.__gypCapture && this.__gypCapture.url) || '';
            if (!shouldCapture(url)) {
              return;
            }

            emit({
              type: 'xhr',
              url,
              headers: this.__gypCapture ? this.__gypCapture.headers : {},
              requestBody: this.__gypCapture ? this.__gypCapture.requestBody : '',
              responseText: this.responseText || '',
              status: this.status,
            });
          });

          return rawSend.apply(this, arguments);
        };
      })();
    `;

    const script = document.createElement('script');
    script.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') {
      return;
    }

    GM_registerMenuCommand('光鸭云盘：预览当前已捕获列表', () => {
      preview().catch((err) => fail('预览失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：重新拉取当前目录并预览', () => {
      preview({ refresh: true }).catch((err) => fail('预览失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：执行批量改名', () => {
      run().catch((err) => fail('执行失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：扫描最里层空目录', () => {
      scanEmptyLeafDirectories().catch((err) => fail('空目录扫描失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：删除已勾选空目录', () => {
      deleteEmptyDirItems().catch((err) => fail('删除空目录失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：预览重复项', () => {
      previewDuplicates({ refresh: true }).catch((err) => fail('重复项预览失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：删除重复项', () => {
      deleteDuplicateItems({ refresh: true }).catch((err) => fail('删除重复项失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：查看云添加任务', () => {
      listCloudTasks()
        .then((response) => {
          console.table(extractCloudTaskRows(response.payload));
        })
        .catch((err) => fail('读取云添加任务失败：', err));
    });

    GM_registerMenuCommand('光鸭云盘：读取当前页面勾选', () => {
      console.table(buildCheckedPageSelectionPreviewItems());
    });

    GM_registerMenuCommand('光鸭云盘：查看捕获状态', () => {
      console.log(LOG_PREFIX, exportState());
    });
  }

  window.addEventListener(CAPTURE_EVENT, (event) => {
    handleCapture(event.detail);
  });

  loadPersistedConfig();
  injectNetworkHook();
  registerMenu();
  mountPanelWhenReady();

  const api = {
    config: CONFIG,
    state: STATE,
    preview,
    previewDuplicates,
    run,
    fetchCurrentList,
    exportState,
    selectDuplicateRows,
    deleteDuplicateItems,
    deleteEmptyDirItems,
    importMagnetTextFiles,
    listCloudTasks,
    buildCheckedPageSelectionPreviewItems,
    moveCheckedFolderContentsToCurrentDirectory,
    moveCheckedItemsUpOneLevel,
    moveCheckedItemsToTargetDirectory,
    scanEmptyLeafDirectories,
    extractMagnetLinks,
    applyPanelConfig,
    savePersistedConfig,
  };

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  pageWindow.gypBatchRenamer = api;

  log('脚本已加载。页面右下角会出现光鸭云盘悬浮面板，也可以在控制台运行 gypBatchRenamer.preview() / gypBatchRenamer.run() / gypBatchRenamer.deleteDuplicateItems() / gypBatchRenamer.importMagnetTextFiles() / gypBatchRenamer.scanEmptyLeafDirectories()。');
})();
