/**
 * obsidian-stub.ts — 把 bare specifier `obsidian` 在测试环境解析到一个真实 fs 后端的 mock。
 * 供 vitest.config.ts 的 alias 使用；插件加载真实构建产物 main.js 时也会命中同一实例。
 */
import { createObsidianModule, type ObsidianModule } from '../e2e/infrastructure';

const mod: ObsidianModule = createObsidianModule();
(globalThis as any).__OBSIDIAN_TEST = mod;

export const Plugin = mod.Plugin;
export const TFile = mod.TFile;
export const TFolder = mod.TFolder;
export const TAbstractFile = mod.TAbstractFile;
export const Notice = mod.Notice;
export const Modal = mod.Modal;
export const ButtonComponent = mod.ButtonComponent;
export const Setting = mod.Setting;
export const PluginSettingTab = mod.PluginSettingTab;
export const normalizePath = mod.normalizePath;
export const requestUrl = mod.requestUrl;

/** 极简 htmlToMarkdown：把 <img> 抽成 `![alt](src)`，供 paste 检测用。 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return html.replace(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*\balt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
}

export default mod;