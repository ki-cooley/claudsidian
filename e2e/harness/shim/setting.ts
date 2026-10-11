// Shim: Setting rows and their components (real inputs: text, textarea, toggle, dropdown, button, slider, extra button).
import { setIcon } from './icons';

export abstract class BaseComponent {
  disabled = false;
  then(cb: (c: this) => unknown): this {
    cb(this);
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
}

export abstract class ValueComponent<T> extends BaseComponent {
  registerOptionListener(listeners: Record<string, (value?: T) => T>, key: string): this {
    const l = listeners[key];
    if (l) this.setValue(l());
    return this;
  }
  abstract getValue(): T;
  abstract setValue(value: T): this;
}

export class AbstractTextComponent<T extends HTMLInputElement | HTMLTextAreaElement> extends ValueComponent<string> {
  constructor(public inputEl: T) {
    super();
  }
  getValue(): string {
    return this.inputEl.value;
  }
  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }
  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return super.setDisabled(disabled);
  }
  onChanged(): void {
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  onChange(cb: (value: string) => unknown): this {
    this.inputEl.addEventListener('input', () => void cb(this.inputEl.value));
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(containerEl: HTMLElement) {
    super(containerEl.createEl('input', { type: 'text' }));
  }
}

export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(containerEl: HTMLElement) {
    super(containerEl.createEl('textarea'));
  }
}

export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  clearButtonEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    const wrap = containerEl.createDiv({ cls: 'search-input-container' });
    super(wrap.createEl('input', { type: 'search' }));
    this.clearButtonEl = wrap.createDiv({ cls: 'search-input-clear-button' });
    this.clearButtonEl.addEventListener('click', () => {
      this.setValue('');
      this.onChanged();
    });
  }
}

export class MomentFormatComponent extends TextComponent {
  sampleEl: HTMLElement = document.createElement('span');
  setDefaultFormat(_f: string): this {
    return this;
  }
  setSampleEl(el: HTMLElement): this {
    this.sampleEl = el;
    return this;
  }
  updateSample(): void {}
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement;
  private value = false;
  private listeners: ((v: boolean) => unknown)[] = [];
  constructor(containerEl: HTMLElement) {
    super();
    this.toggleEl = containerEl.createDiv({ cls: 'checkbox-container', attr: { role: 'checkbox', tabindex: '0', 'aria-checked': 'false' } });
    this.toggleEl.createEl('input', { type: 'checkbox', attr: { tabindex: '-1' } });
    this.toggleEl.addEventListener('click', () => {
      if (this.disabled) return;
      this.setValue(!this.value);
      for (const l of this.listeners) void l(this.value);
    });
  }
  getValue(): boolean {
    return this.value;
  }
  setValue(on: boolean): this {
    this.value = on;
    this.toggleEl.toggleClass('is-enabled', on);
    this.toggleEl.setAttribute('aria-checked', String(on));
    (this.toggleEl.querySelector('input') as HTMLInputElement).checked = on;
    return this;
  }
  setTooltip(tooltip: string): this {
    this.toggleEl.setAttribute('aria-label', tooltip);
    return this;
  }
  onClick(): void {
    this.toggleEl.click();
  }
  onChange(cb: (value: boolean) => unknown): this {
    this.listeners.push(cb);
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.selectEl = containerEl.createEl('select', { cls: 'dropdown' });
  }
  addOption(value: string, display: string): this {
    this.selectEl.createEl('option', { value, text: display });
    return this;
  }
  addOptions(options: Record<string, string>): this {
    for (const [k, v] of Object.entries(options)) this.addOption(k, v);
    return this;
  }
  getValue(): string {
    return this.selectEl.value;
  }
  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.selectEl.disabled = disabled;
    return super.setDisabled(disabled);
  }
  onChange(cb: (value: string) => unknown): this {
    this.selectEl.addEventListener('change', () => void cb(this.selectEl.value));
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.buttonEl = containerEl.createEl('button');
  }
  setButtonText(text: string): this {
    this.buttonEl.setText(text);
    return this;
  }
  setIcon(icon: string): this {
    setIcon(this.buttonEl, icon);
    return this;
  }
  setCta(): this {
    this.buttonEl.addClass('mod-cta');
    return this;
  }
  removeCta(): this {
    this.buttonEl.removeClass('mod-cta');
    return this;
  }
  setWarning(): this {
    this.buttonEl.addClass('mod-warning');
    return this;
  }
  setClass(cls: string): this {
    this.buttonEl.addClass(cls);
    return this;
  }
  setTooltip(tooltip: string): this {
    this.buttonEl.setAttribute('aria-label', tooltip);
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return super.setDisabled(disabled);
  }
  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener('click', (ev) => void cb(ev));
    return this;
  }
}

export class ExtraButtonComponent extends BaseComponent {
  extraSettingsEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.extraSettingsEl = containerEl.createDiv({ cls: 'clickable-icon extra-setting-button', attr: { role: 'button', tabindex: '0' } });
  }
  setIcon(icon: string): this {
    setIcon(this.extraSettingsEl, icon);
    return this;
  }
  setTooltip(tooltip: string): this {
    this.extraSettingsEl.setAttribute('aria-label', tooltip);
    return this;
  }
  onClick(cb: () => unknown): this {
    this.extraSettingsEl.addEventListener('click', () => void cb());
    return this;
  }
}

export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.sliderEl = containerEl.createEl('input', { type: 'range', cls: 'slider' });
  }
  setLimits(min: number, max: number, step: number | 'any'): this {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  getValue(): number {
    return Number(this.sliderEl.value);
  }
  setValue(value: number): this {
    this.sliderEl.value = String(value);
    return this;
  }
  setInstant(_instant: boolean): this {
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  showTooltip(): void {}
  onChange(cb: (value: number) => unknown): this {
    this.sliderEl.addEventListener('input', () => void cb(this.getValue()));
    return this;
  }
}

export class ColorComponent extends ValueComponent<string> {
  colorEl: HTMLInputElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.colorEl = containerEl.createEl('input', { type: 'color' });
  }
  getValue(): string {
    return this.colorEl.value;
  }
  setValue(value: string): this {
    this.colorEl.value = value;
    return this;
  }
  onChange(cb: (value: string) => unknown): this {
    this.colorEl.addEventListener('input', () => void cb(this.colorEl.value));
    return this;
  }
}

export class ProgressBarComponent extends ValueComponent<number> {
  progressBar: HTMLElement;
  private value = 0;
  constructor(containerEl: HTMLElement) {
    super();
    this.progressBar = containerEl.createDiv({ cls: 'progress-bar' });
  }
  getValue(): number {
    return this.value;
  }
  setValue(value: number): this {
    this.value = value;
    this.progressBar.style.setProperty('--progress', `${value}%`);
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: BaseComponent[] = [];

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
  }

  setName(name: string | DocumentFragment): this {
    this.nameEl.setText(name);
    this.settingEl.setAttribute('data-setting-name', typeof name === 'string' ? name : name.textContent ?? '');
    return this;
  }
  setDesc(desc: string | DocumentFragment): this {
    this.descEl.setText(desc);
    return this;
  }
  setClass(cls: string): this {
    this.settingEl.addClass(cls);
    return this;
  }
  setTooltip(tooltip: string): this {
    this.settingEl.setAttribute('aria-label', tooltip);
    return this;
  }
  setHeading(): this {
    this.settingEl.addClass('setting-item-heading');
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.settingEl.toggleClass('is-disabled', disabled);
    for (const c of this.components) c.setDisabled(disabled);
    return this;
  }
  clear(): this {
    this.controlEl.empty();
    this.components = [];
    return this;
  }
  then(cb: (s: this) => unknown): this {
    cb(this);
    return this;
  }

  private add<T extends BaseComponent>(c: T, cb: (c: T) => unknown): this {
    this.components.push(c);
    cb(c);
    return this;
  }
  addButton(cb: (c: ButtonComponent) => unknown): this {
    return this.add(new ButtonComponent(this.controlEl), cb);
  }
  addExtraButton(cb: (c: ExtraButtonComponent) => unknown): this {
    return this.add(new ExtraButtonComponent(this.controlEl), cb);
  }
  addToggle(cb: (c: ToggleComponent) => unknown): this {
    return this.add(new ToggleComponent(this.controlEl), cb);
  }
  addText(cb: (c: TextComponent) => unknown): this {
    return this.add(new TextComponent(this.controlEl), cb);
  }
  addSearch(cb: (c: SearchComponent) => unknown): this {
    return this.add(new SearchComponent(this.controlEl), cb);
  }
  addTextArea(cb: (c: TextAreaComponent) => unknown): this {
    return this.add(new TextAreaComponent(this.controlEl), cb);
  }
  addMomentFormat(cb: (c: MomentFormatComponent) => unknown): this {
    return this.add(new MomentFormatComponent(this.controlEl), cb);
  }
  addDropdown(cb: (c: DropdownComponent) => unknown): this {
    return this.add(new DropdownComponent(this.controlEl), cb);
  }
  addColorPicker(cb: (c: ColorComponent) => unknown): this {
    return this.add(new ColorComponent(this.controlEl), cb);
  }
  addProgressBar(cb: (c: ProgressBarComponent) => unknown): this {
    return this.add(new ProgressBarComponent(this.controlEl), cb);
  }
  addSlider(cb: (c: SliderComponent) => unknown): this {
    return this.add(new SliderComponent(this.controlEl), cb);
  }
}
