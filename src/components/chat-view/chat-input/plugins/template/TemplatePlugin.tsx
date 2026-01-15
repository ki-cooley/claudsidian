import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createTextNode, $getRoot } from 'lexical'
import clsx from 'clsx'
import {
  $parseSerializedNode,
  COMMAND_PRIORITY_NORMAL,
  TextNode,
} from 'lexical'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { Template } from '../../../../../database/json/template/types'
import { useTemplateManager } from '../../../../../hooks/useJsonManagers'
import { useSkills, Skill, SlashCommand } from '../../../../../hooks/useSkills'
import { MenuOption } from '../shared/LexicalMenu'
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from '../typeahead-menu/LexicalTypeaheadMenuPlugin'

type SlashCommandType = 'template' | 'skill' | 'command'

class SlashCommandOption extends MenuOption {
  name: string
  description: string
  type: SlashCommandType
  template?: Template
  skill?: Skill
  command?: SlashCommand

  constructor(
    name: string,
    description: string,
    type: SlashCommandType,
    data: Template | Skill | SlashCommand
  ) {
    super(name)
    this.name = name
    this.description = description
    this.type = type
    if (type === 'template') {
      this.template = data as Template
    } else if (type === 'skill') {
      this.skill = data as Skill
    } else {
      this.command = data as SlashCommand
    }
  }
}

// Keep old class for backwards compatibility
class TemplateTypeaheadOption extends MenuOption {
  name: string
  template: Template

  constructor(name: string, template: Template) {
    super(name)
    this.name = name
    this.template = template
  }
}

function SlashCommandMenuItem({
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: {
  index: number
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  option: SlashCommandOption
}) {
  return (
    <li
      key={option.key}
      tabIndex={-1}
      className={clsx('item', isSelected && 'selected')}
      ref={(el) => option.setRefElement(el)}
      role="option"
      aria-selected={isSelected}
      id={`typeahead-item-${index}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <div className="smtcmp-template-menu-item">
        <div className="smtcmp-slash-command-item">
          <span className="smtcmp-slash-command-name">/{option.name}</span>
          {option.type === 'skill' && (
            <span className="smtcmp-slash-command-badge smtcmp-badge-skill">skill</span>
          )}
          {option.type === 'command' && (
            <span className="smtcmp-slash-command-badge smtcmp-badge-command">cmd</span>
          )}
        </div>
        <div className="smtcmp-slash-command-desc">{option.description}</div>
      </div>
    </li>
  )
}

export default function TemplatePlugin() {
  const [editor] = useLexicalComposerContext()
  const templateManager = useTemplateManager()
  const { skills, commands, searchSkills, searchCommands } = useSkills()

  const [queryString, setQueryString] = useState<string | null>(null)
  const [templateResults, setTemplateResults] = useState<Template[]>([])

  useEffect(() => {
    if (queryString == null) return
    templateManager.searchTemplates(queryString).then(setTemplateResults)
  }, [queryString, templateManager])

  // Combine commands, skills, and templates into unified options
  const options = useMemo(() => {
    const result: SlashCommandOption[] = []

    // Add slash commands first (highest priority)
    const matchingCommands = queryString != null ? searchCommands(queryString) : commands
    for (const cmd of matchingCommands) {
      const desc = cmd.argumentHint
        ? `${cmd.description} ${cmd.argumentHint}`
        : cmd.description
      result.push(
        new SlashCommandOption(cmd.name, desc, 'command', cmd)
      )
    }

    // Add skills
    const matchingSkills = queryString != null ? searchSkills(queryString) : skills
    for (const skill of matchingSkills) {
      result.push(
        new SlashCommandOption(skill.name, skill.description, 'skill', skill)
      )
    }

    // Add templates
    for (const template of templateResults) {
      result.push(
        new SlashCommandOption(template.name, 'Template', 'template', template)
      )
    }

    return result
  }, [templateResults, skills, commands, queryString, searchSkills, searchCommands])

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
    minLength: 0,
  })

  const onSelectOption = useCallback(
    (
      selectedOption: SlashCommandOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        if (selectedOption.type === 'template' && selectedOption.template) {
          // For templates, insert the template content
          const parsedNodes = selectedOption.template.content.nodes.map((node) =>
            $parseSerializedNode(node),
          )
          if (nodeToRemove) {
            const parent = nodeToRemove.getParentOrThrow()
            parent.splice(nodeToRemove.getIndexWithinParent(), 1, parsedNodes)
            const lastNode = parsedNodes[parsedNodes.length - 1]
            lastNode.selectEnd()
          }
        } else if (selectedOption.type === 'skill' && selectedOption.skill) {
          // For skills, replace with the skill command text
          const skillCommand = `Run the "${selectedOption.skill.name}" skill`
          if (nodeToRemove) {
            const textNode = $createTextNode(skillCommand)
            nodeToRemove.replace(textNode)
            textNode.selectEnd()
          } else {
            // Append to root if no node to remove
            const root = $getRoot()
            const textNode = $createTextNode(skillCommand)
            root.append(textNode)
            textNode.selectEnd()
          }
        } else if (selectedOption.type === 'command' && selectedOption.command) {
          // For slash commands, insert the command with placeholder for args
          const cmdText = selectedOption.command.argumentHint
            ? `/${selectedOption.command.name} `
            : `/${selectedOption.command.name}`
          if (nodeToRemove) {
            const textNode = $createTextNode(cmdText)
            nodeToRemove.replace(textNode)
            textNode.selectEnd()
          } else {
            const root = $getRoot()
            const textNode = $createTextNode(cmdText)
            root.append(textNode)
            textNode.selectEnd()
          }
        }
        closeMenu()
      })
    },
    [editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      commandPriority={COMMAND_PRIORITY_NORMAL}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        anchorElementRef.current && options.length
          ? createPortal(
              <div
                className="smtcmp-popover"
                style={{
                  position: 'fixed',
                }}
              >
                <ul>
                  {options.map((option, i: number) => (
                    <SlashCommandMenuItem
                      index={i}
                      isSelected={selectedIndex === i}
                      onClick={() => {
                        setHighlightedIndex(i)
                        selectOptionAndCleanUp(option)
                      }}
                      onMouseEnter={() => {
                        setHighlightedIndex(i)
                      }}
                      key={option.key}
                      option={option}
                    />
                  ))}
                </ul>
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  )
}
