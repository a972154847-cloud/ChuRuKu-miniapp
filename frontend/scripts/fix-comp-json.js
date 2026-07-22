const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '../dist');
const compJsonPath = path.join(distDir, 'comp.json');
const projectConfigPath = path.join(distDir, 'project.config.json');
const sitemapPath = path.join(distDir, 'sitemap.json');

const REAL_APPID = 'wx60a0c04ff6885b0d';

let fixedCount = 0;

try {
  const json = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'));
  let changed = false;
  if (json.appid !== REAL_APPID) {
    json.appid = REAL_APPID;
    changed = true;
  }
  if (json.miniprogramRoot !== '') {
    json.miniprogramRoot = '';
    changed = true;
  }
  if (json.setting) {
    if (json.setting.es6 !== false) {
      json.setting.es6 = false;
      changed = true;
    }
    if (json.setting.enhance !== false) {
      json.setting.enhance = false;
      changed = true;
    }
    if (json.setting.minified !== false) {
      json.setting.minified = false;
      changed = true;
    }
    if (json.setting.swc !== false) {
      json.setting.swc = false;
      changed = true;
    }
    if (json.setting.disableSWC !== true) {
      json.setting.disableSWC = true;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(projectConfigPath, JSON.stringify(json, null, 2));
    console.log(`[fix-comp-json] Fixed project.config.json: appid=${REAL_APPID}, es6=false, enhance=false, minified=false`);
    fixedCount++;
  }
} catch (e) {
  console.error('[fix-comp-json] Error fixing project.config.json:', e);
}

if (fs.existsSync(compJsonPath)) {
  try {
    const content = fs.readFileSync(compJsonPath, 'utf-8');
    const json = JSON.parse(content);
    if (json.usingComponents && json.usingComponents.comp) {
      delete json.usingComponents.comp;
      fs.writeFileSync(compJsonPath, JSON.stringify(json, null, 2));
      console.log('[fix-comp-json] Removed circular reference from comp.json');
      fixedCount++;
    }
  } catch (e) {
    console.error('[fix-comp-json] Error parsing comp.json:', e);
  }
}

if (!fs.existsSync(sitemapPath)) {
  const sitemap = {
    desc: '关于本文件的更多信息，请参考文档 https://developers.weixin.qq.com/miniprogram/dev/framework/sitemap.html',
    rules: [{ action: 'allow', page: '*' }]
  };
  fs.writeFileSync(sitemapPath, JSON.stringify(sitemap, null, 2));
  console.log('[fix-comp-json] Created sitemap.json (required by lib 3.15.3+)');
  fixedCount++;
}

console.log(`[fix-comp-json] Total ${fixedCount} files fixed`);
