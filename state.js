(function() {
    var KEY_ACC = 'moments_accounts',
        KEY_CUR = 'moments_current',
        KEY_POSTS = 'moments_posts',
        KEY_AI = 'moments_ai_config',
        KEY_THEME = 'moments_theme';

    var getJSON = function(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch(e) { return []; } };
    var setJSON = function(k, v) { localStorage.setItem(k, JSON.stringify(v)); };

    var accounts = [];
    var currentId = localStorage.getItem(KEY_CUR);
    var posts = [];
    var AI_DEFAULTS = { endpoint: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-v4-pro', timeout: 15 };
    var aiConfig = Object.assign({}, AI_DEFAULTS, getJSON(KEY_AI) || {});

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

    function saveAIConfig() { setJSON(KEY_AI, window.App.aiConfig || aiConfig); }

    var KEY_ACTIVE_AI = 'moments_active_ai';
    var KEY_RANDOM_AI = 'moments_random_ai';
    var activeAIId = localStorage.getItem(KEY_ACTIVE_AI);
    var randomAIMode = localStorage.getItem(KEY_RANDOM_AI) === 'true';

    function ensureAIAccount() {
        var currentAccounts = window.App.accounts || [];
        var currentActiveAIId = window.App.activeAIId;
        
        currentAccounts.filter(function(a) { return a.id === 'acc_ai'; }).forEach(function(a) { a.isAI = true; });

        if (currentActiveAIId && !currentAccounts.find(function(a) { return a.id === currentActiveAIId && a.isAI; })) {
            var newActiveAIId = currentAccounts.find(function(a) { return a.isAI; }) ? currentAccounts.find(function(a) { return a.isAI; }).id : null;
            window.App.activeAIId = newActiveAIId;
            if (newActiveAIId) localStorage.setItem(KEY_ACTIVE_AI, newActiveAIId);
            else localStorage.removeItem(KEY_ACTIVE_AI);
        }
    }

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
    window.App.aiConfig = aiConfig;
    window.App.AI_DEFAULTS = AI_DEFAULTS;
    window.App.activeAIId = activeAIId;
    window.App.randomAIMode = randomAIMode;
    window.App.saveAccounts = saveAccounts;
    window.App.savePosts = savePosts;
    window.App.saveAIConfig = saveAIConfig;
    window.App.ensureAIAccount = ensureAIAccount;
    window.App.getAcc = getAcc;
    window.App.getCurAcc = getCurAcc;
})();
