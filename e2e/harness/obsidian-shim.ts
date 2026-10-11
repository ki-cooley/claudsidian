// The `obsidian` module as the browser harness sees it: the subset of the API the plugin imports, with the same
// names as the real module. Pieces live under ./shim; this file only re-exports them and installs the DOM helpers.
import { installDomHelpers } from '../../test/mocks/dom-helpers';

installDomHelpers();

export { Events, Component } from './shim/events';
export type { EventRef } from './shim/events';
export { TAbstractFile, TFile, TFolder, Vault, MetadataCache, FileManager } from './shim/files';
export { Editor } from './shim/editor';
export type { EditorPosition, EditorRange, EditorSelection } from './shim/editor';
export { View, ItemView, FileView, EditableFileView, TextFileView, MarkdownView, WorkspaceLeaf, Workspace } from './shim/workspace';
export type { ViewState, ViewCreator } from './shim/workspace';
export { App, Plugin, PluginSettingTab, SettingTab } from './shim/app';
export type { PluginManifest, Command } from './shim/app';
export { Modal, ConfirmationModal, Notice, SuggestModal, FuzzySuggestModal } from './shim/modal';
export type { FuzzyMatch } from './shim/modal';
export {
  Setting,
  BaseComponent,
  ValueComponent,
  AbstractTextComponent,
  TextComponent,
  TextAreaComponent,
  SearchComponent,
  MomentFormatComponent,
  ToggleComponent,
  DropdownComponent,
  ButtonComponent,
  ExtraButtonComponent,
  SliderComponent,
  ColorComponent,
  ProgressBarComponent,
} from './shim/setting';
export { Menu, MenuItem, MenuSeparator, PopoverSuggest, AbstractInputSuggest, EditorSuggest } from './shim/menu';
export { MarkdownRenderer, MarkdownRenderChild, MarkdownPreviewView, sanitizeHTMLToDom, htmlToMarkdown } from './shim/markdown';
export { setIcon, getIcon, addIcon, removeIcon, getIconIds } from './shim/icons';
export {
  Platform,
  apiVersion,
  requireApiVersion,
  requestUrl,
  request,
  debounce,
  normalizePath,
  getLinkpath,
  parseLinktext,
  stripHeading,
  stripHeadingForLink,
  getAllTags,
  getFrontMatterInfo,
  parseFrontMatterAliases,
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
  parseFrontMatterTags,
  parseYaml,
  stringifyYaml,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  arrayBufferToHex,
  hexToArrayBuffer,
  getBlobArrayBuffer,
  loadMathJax,
  loadMermaid,
  loadPdfJs,
  loadPrism,
  finishRenderMath,
  renderMath,
  getLanguage,
  prepareSimpleSearch,
  prepareFuzzySearch,
  fuzzySearch,
  prepareQuery,
  renderResults,
  renderMatches,
  sortSearchResults,
  setTooltip,
  displayTooltip,
  Keymap,
  Scope,
  moment,
  editorEditorField,
  editorInfoField,
  editorLivePreviewField,
  editorViewField,
  livePreviewState,
} from './shim/platform';
export type { RequestUrlParam, RequestUrlResponse, Debouncer } from './shim/platform';
