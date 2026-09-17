import { useState } from 'react'

import { Avatar, EmptyState } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { getEngine, useLatido } from '@/state/store'
import type { UserList } from '@latido/engine'

/**
 * Listas: colecciones propias. Sirven para separar mundos que no se mezclan
 * (trabajo, videojuegos, investigación) sin depender de etiquetas de terceros.
 */
export function ListsScreen(): JSX.Element {
  const { t, toast, selectItem } = useLatido()

  const [lists, setLists] = useState<UserList[]>(() => getEngine().store.allLists())
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const commit = (next: UserList[]): void => {
    setLists(next)
    getEngine().store.putLists(next)
  }

  const create = (): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    const list: UserList = { id: `list-${Date.now().toString(36)}`, name: trimmed, members: [], createdAt: Date.now() }
    commit([...lists, list])
    setName('')
    setOpenId(list.id)
    toast(`${t('lists.create')} · ${trimmed}`, 'ok')
  }

  return (
    <div className="content content--narrow">
      <section className="section section--tight">
        <div className="inline">
          <label className="search-field">
            <Icon name="layers" size="sm" />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create()
              }}
              placeholder={t('lists.name')}
              aria-label={t('lists.name')}
            />
          </label>
          <button type="button" className="btn btn--primary" onClick={create} disabled={name.trim().length === 0}>
            <Icon name="plus" size="sm" />
            {t('lists.create')}
          </button>
        </div>
      </section>

      {lists.length === 0 ? (
        <EmptyState icon="layers" title={t('lists.empty')} hint={t('lists.subtitle')} />
      ) : (
        <section className="section">
          {lists.map((list) => {
            const open = openId === list.id
            return (
              <article className="panel" key={list.id}>
                <div className="panel__head">
                  <button
                    type="button"
                    className="row__title"
                    onClick={() => setOpenId(open ? null : list.id)}
                    style={{ textAlign: 'left' }}
                  >
                    {list.name}{' '}
                    <span className="mono micro faint">{t('lists.members', { count: list.members.length })}</span>
                  </button>
                  <span className="inline">
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size="sm" />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Eliminar"
                      title="Eliminar"
                      onClick={() => {
                        getEngine().store.removeList(list.id)
                        commit(lists.filter((entry) => entry.id !== list.id))
                      }}
                    >
                      <Icon name="trash" size="sm" />
                    </button>
                  </span>
                </div>

                {open ? <ListMembers list={list} onChange={commit} lists={lists} /> : null}
              </article>
            )
          })}
        </section>
      )}

      <section className="section section--tight">
        <span className="label">{t('following.timeline')}</span>
        <div className="stream">
          {getEngine()
            .feed({ limit: 5 })
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="rail-trend"
                onClick={() => selectItem(item.id)}
              >
                <Avatar name={item.author.handle} size="sm" />
                <span className="grow">
                  <span className="rail-trend__title">{item.title ?? item.body ?? item.url}</span>
                </span>
              </button>
            ))}
        </div>
      </section>
    </div>
  )
}

function ListMembers({
  list,
  lists,
  onChange,
}: {
  list: UserList
  lists: UserList[]
  onChange: (next: UserList[]) => void
}): JSX.Element {
  const { t, entities } = useLatido()
  const [pick, setPick] = useState('')

  const add = (slug: string): void => {
    if (slug.length === 0 || list.members.includes(slug)) return
    onChange(lists.map((entry) => (entry.id === list.id ? { ...entry, members: [...entry.members, slug] } : entry)))
    setPick('')
  }

  const remove = (slug: string): void => {
    onChange(
      lists.map((entry) =>
        entry.id === list.id ? { ...entry, members: entry.members.filter((member) => member !== slug) } : entry,
      ),
    )
  }

  return (
    <div className="stack">
      <div className="kindlist">
        {list.members.length === 0 ? <span className="micro faint">—</span> : null}
        {list.members.map((slug) => (
          <span className="chip" key={slug}>
            {entities.find((entity) => entity.slug === slug)?.name ?? slug}
            <button type="button" className="icon-btn" style={{ width: '1.25rem', height: '1.25rem' }} onClick={() => remove(slug)} aria-label="Quitar">
              <Icon name="close" size="sm" />
            </button>
          </span>
        ))}
      </div>
      <div className="inline">
        <select className="select grow" value={pick} onChange={(event) => add(event.target.value)}>
          <option value="">{t('lists.members', { count: list.members.length })}</option>
          {entities
            .filter((entity) => !list.members.includes(entity.slug))
            .slice(0, 60)
            .map((entity) => (
              <option key={entity.slug} value={entity.slug}>
                {entity.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  )
}
