const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '../dist');
const compJsonPath = path.join(distDir, 'comp.json');

// 真实小程序 AppID（Taro 构建会生成占位 touristappid，这里统一修正）
const REAL_APPID = 'wx60a0c04ff6885b0d';

let fixedCount = 0;

// 1) 修正 project.config.json 中的 appid 和编译设置
const projectConfigPath = path.join(distDir, 'project.config.json');
if (fs.existsSync(projectConfigPath)) {
  try {
    const json = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'));
    let changed = false;
    if (json.appid !== REAL_APPID) {
      json.appid = REAL_APPID;
      changed = true;
    }
    if (!json.setting) {
      json.setting = {};
    }
    if (json.setting.minified !== true) {
      json.setting.minified = true;
      changed = true;
    }
    if (json.setting.es6 !== true) {
      json.setting.es6 = true;
      changed = true;
    }
    if (json.setting.enhance !== true) {
      json.setting.enhance = true;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(projectConfigPath, JSON.stringify(json, null, 2));
      console.log(`[fix-comp-json] Fixed project.config.json: appid=${REAL_APPID}, minified=true, es6=true`);
      fixedCount++;
    }
  } catch (e) {
    console.error('[fix-comp-json] Error fixing project.config.json:', e);
  }
}

if (fs.existsSync(compJsonPath)) {
  const content = fs.readFileSync(compJsonPath, 'utf-8');
  try {
    const json = JSON.parse(content);
    if (json.usingComponents && json.usingComponents.comp === './comp') {
      delete json.usingComponents.comp;
      fs.writeFileSync(compJsonPath, JSON.stringify(json));
      console.log('[fix-comp-json] Fixed circular reference in comp.json');
      fixedCount++;
    }
  } catch (e) {
    console.error('[fix-comp-json] Error parsing comp.json:', e);
  }
} else {
  console.log('[fix-comp-json] comp.json not found');
}

const pagesDir = path.join(distDir, 'pages');
if (fs.existsSync(pagesDir)) {
  const pageDirs = fs.readdirSync(pagesDir);
  for (const pageDir of pageDirs) {
    const indexJsonPath = path.join(pagesDir, pageDir, 'index.json');
    if (fs.existsSync(indexJsonPath)) {
      try {
        const content = fs.readFileSync(indexJsonPath, 'utf-8');
        const json = JSON.parse(content);
        if (json.usingComponents && json.usingComponents.comp) {
          delete json.usingComponents.comp;
          if (Object.keys(json.usingComponents).length === 0) {
            delete json.usingComponents;
          }
          fs.writeFileSync(indexJsonPath, JSON.stringify(json));
          console.log(`[fix-comp-json] Removed comp reference from ${pageDir}/index.json`);
          fixedCount++;
        }
      } catch (e) {
        console.error(`[fix-comp-json] Error parsing ${pageDir}/index.json:`, e);
      }
    }
  }
}

console.log(`[fix-comp-json] Total ${fixedCount} files fixed`);
