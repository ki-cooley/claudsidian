import { App } from 'obsidian'

import SmartComposerPlugin from '../../main'
import { ObsidianButton } from '../common/ObsidianButton'
import { ObsidianSetting } from '../common/ObsidianSetting'

import { ChatSection } from './sections/ChatSection'
import { EtcSection } from './sections/EtcSection'
import { McpSection } from './sections/McpSection'
import { ModelsSection } from './sections/ModelsSection'
import { ProvidersSection } from './sections/ProvidersSection'
import { RAGSection } from './sections/RAGSection'
import { TemplateSection } from './sections/TemplateSection'

type SettingsTabRootProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function SettingsTabRoot({ app, plugin }: SettingsTabRootProps) {
  return (
    <>
      <ObsidianSetting
        name="Support Claudsidian"
        desc="If you find Claudsidian valuable, consider supporting its development!"
        heading
        className="smtcmp-settings-support-smart-composer"
      >
        <ObsidianButton
          text="View on GitHub"
          onClick={() =>
            window.open('https://github.com/ki-cooley/claudsidian', '_blank')
          }
          cta
        />
      </ObsidianSetting>
      <ChatSection />
      <ProvidersSection app={app} plugin={plugin} />
      <ModelsSection app={app} plugin={plugin} />
      <RAGSection app={app} plugin={plugin} />
      <McpSection app={app} plugin={plugin} />
      <TemplateSection app={app} />
      <EtcSection app={app} plugin={plugin} />
    </>
  )
}
