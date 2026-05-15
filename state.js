(function() {
    var namespaceName = new URLSearchParams(location.search).get('ns') || '';
    var NS = (namespaceName || 'moments') + '_';
    var KEY_ACC = NS + 'accounts',
        KEY_CUR = NS + 'current',
        KEY_POSTS = NS + 'posts',
        KEY_AI = NS + 'ai_config',
        KEY_AI_PRESETS = NS + 'ai_presets',
        KEY_ACTIVE_PRESET = NS + 'active_preset',
        KEY_THEME = NS + 'theme';

    var getJSON = function(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch(e) { return []; } };
    var setJSON = function(k, v) { localStorage.setItem(k, JSON.stringify(v)); };

    var accounts = [];
    var currentId = localStorage.getItem(KEY_CUR);
    var posts = [];
    var AI_DEFAULT_PRESET = { id: 'preset_default', name: '默认方案', endpoint: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-v4-pro', timeout: 15, vision: false, thinking: false };

    function loadAIPresets() {
        var presets = getJSON(KEY_AI_PRESETS) || [];
        if (!presets.length) presets = [Object.assign({}, AI_DEFAULT_PRESET)];
        return presets;
    }

    var aiPresets = loadAIPresets();
    var activePresetId = localStorage.getItem(KEY_ACTIVE_PRESET) || aiPresets[0].id;
    if (!aiPresets.find(function(p) { return p.id === activePresetId; })) activePresetId = aiPresets[0].id;
    var aiConfig = aiPresets.find(function(p) { return p.id === activePresetId; }) || aiPresets[0];

    function saveAccounts() {
        var accs = window.App.accounts || accounts;
        var psts = window.App.posts || posts;
        window.App.saveAppData(KEY_ACC, accs);
        // 标记本地脏数据，触发带时间戳保护的上传
        // （仅当本地比云端新时才实际上传，避免无效覆盖）
        if (window.App.markLocalDirty) window.App.markLocalDirty();
        if (window.App.uploadToCloud) window.App.uploadToCloud(false);
    }

    function savePosts() {
        var accs = window.App.accounts || accounts;
        var psts = window.App.posts || posts;
        window.App.saveAppData(KEY_POSTS, psts);
        if (window.App.markLocalDirty) window.App.markLocalDirty();
        if (window.App.uploadToCloud) window.App.uploadToCloud(false);
    }

    function saveAIPresets() {
        setJSON(KEY_AI_PRESETS, window.App.aiPresets);
        localStorage.setItem(KEY_ACTIVE_PRESET, window.App.activePresetId);
    }
    function switchAIPreset(id, persist) {
        var preset = window.App.aiPresets.find(function(p) { return p.id === id; });
        if (!preset) return;
        window.App.activePresetId = id;
        window.App.aiConfig = preset;
        // persist 默认 false：切换时仅更新内存引用，不立即写磁盘
        // 调用方在 saveFormToPreset 之后再显式调用 saveAIPresets() 落盘
        if (persist) saveAIPresets();
    }
    function normalizeAIPresets() {
        var defaults = window.App.AI_DEFAULT_PRESET;
        var presets = window.App.aiPresets;
        if (!presets || !presets.length) return;
        for (var i = 0; i < presets.length; i++) {
            for (var key in defaults) {
                if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
                if (!(key in presets[i])) presets[i][key] = defaults[key];
            }
        }
    }
    function deleteAIPreset(id) {
        var presets = window.App.aiPresets;
        if (presets.length <= 1) return;
        var idx = presets.findIndex(function(p) { return p.id === id; });
        if (idx === -1) return;
        presets.splice(idx, 1);
        if (window.App.activePresetId === id) {
            window.App.activePresetId = presets[0].id;
            window.App.aiConfig = presets[0];
        }
        saveAIPresets();
    }

    var KEY_ACTIVE_AI = NS + 'active_ai';
    var KEY_RANDOM_AI = NS + 'random_ai';
    var activeAIId = localStorage.getItem(KEY_ACTIVE_AI);
    var randomAIMode = localStorage.getItem(KEY_RANDOM_AI) === 'true';

    function getAcc(id) {
        var currentAccounts = window.App.accounts || [];
        return currentAccounts.find(function(a) { return a.id === id; }) || null; 
    }
    function getCurAcc() { 
        var curId = window.App.currentId;
        var currentAccounts = window.App.accounts || [];
        return getAcc(curId) || currentAccounts[0] || null; 
    }

    window.App = window.App || {};
    window.App.NS = NS;
    window.App.namespaceName = namespaceName;
    window.App.KEY_ACC = KEY_ACC;
    window.App.KEY_CUR = KEY_CUR;
    window.App.KEY_POSTS = KEY_POSTS;
    window.App.KEY_AI = KEY_AI;
    window.App.KEY_THEME = KEY_THEME;
    window.App.KEY_ACTIVE_AI = KEY_ACTIVE_AI;
    window.App.KEY_RANDOM_AI = KEY_RANDOM_AI;
    window.App.getJSON = getJSON;
    window.App.setJSON = setJSON;
    window.App.accounts = accounts;
    window.App.currentId = currentId;
    window.App.posts = posts;
    window.App.aiPresets = aiPresets;
    window.App.activePresetId = activePresetId;
    window.App.aiConfig = aiConfig;
    window.App.AI_DEFAULT_PRESET = AI_DEFAULT_PRESET;
    window.App.activeAIId = activeAIId;
    window.App.randomAIMode = randomAIMode;
    window.App.saveAccounts = saveAccounts;
    window.App.savePosts = savePosts;
    window.App.saveAIPresets = saveAIPresets;
    window.App.switchAIPreset = switchAIPreset;
    window.App.normalizeAIPresets = normalizeAIPresets;
    window.App.deleteAIPreset = deleteAIPreset;
    window.App.getAcc = getAcc;
    window.App.getCurAcc = getCurAcc;
})();
