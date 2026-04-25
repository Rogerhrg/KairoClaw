import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { getEntries, updateEntry, deleteEntry, type CollectionName } from '../api/client';
import type { CollectionMeta } from '../DataPanel';
import { EditPopup } from '../DataPanel';

interface CollectionPageProps {
  collection: CollectionMeta;
  token: string;
}

export function CollectionPage({ collection, token }: CollectionPageProps) {
  const [data, setData] = useState<{ items: Record<string, unknown>[]; total: number; pages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [showCompleted, setShowCompleted] = useState(false);

  const toggleDay = (day: string) => {
    setExpandedDays(prev => ({ ...prev, [day]: !prev[day] }));
  };

  const groupItemsByDay = (items: Record<string, unknown>[]) => {
    const groups: Record<string, Record<string, unknown>[]> = {};
    items.forEach(item => {
      const date = new Date(item.timestamp as string);
      const dayKey = toTitleCase(date.toLocaleDateString('es-MX', { 
        weekday: 'long',
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'America/Monterrey'
      }));
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(item);
    });
    return groups;
  };

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await getEntries(collection.name as CollectionName, token, p, 50);
        setData(res);
      } finally {
        setLoading(false);
      }
    },
    [collection.name, token]
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    try {
      await deleteEntry(collection.name as CollectionName, id, token);
      load(page);
    } catch {
      alert('Error al eliminar.');
    }
  };

  const handleStatusUpdate = async (item: Record<string, unknown>, newStatus: string) => {
    try {
      await updateEntry('todo', String(item._id), { ...item, status: newStatus }, token);
      load(page);
    } catch (err) {
      console.error('Failed to update status:', err);
      alert('Error al actualizar el estado.');
    }
  };

  const toTitleCase = (str: string): string => {
    if (!str) return '';
    const exceptions = ['de', 'del', 'la', 'el', 'en', 'con', 'y', 'o', 'a', 'los', 'las', 'un', 'una', 'unos', 'unas'];
    return str
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (index > 0 && exceptions.includes(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  };

  const fmtDate = (val: unknown): string => {
    if (!val) return '';
    try {
      const d = new Date(val as string);
      return toTitleCase(d.toLocaleDateString('es-MX', { 
        weekday: 'long',
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'America/Monterrey'
      }));
    } catch {
      return String(val);
    }
  };

  const fmtTime = (val: unknown): string => {
    if (!val) return '';
    try {
      const d = new Date(val as string);
      return d.toLocaleTimeString('es-MX', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Monterrey'
      });
    } catch {
      return '';
    }
  };

  const fmtCurrency = (val: unknown): string => {
    const n = Number(val);
    if (isNaN(n)) return '';
    return new Intl.NumberFormat('es-MX', { 
      style: 'currency', 
      currency: 'MXN' 
    }).format(n);
  };

  const shortTitle = (item: Record<string, unknown>): string => {
    const raw = item[collection.titleField];
    if (!raw) return String(item._id);
    const s = toTitleCase(String(raw));
    return s.length > 50 ? s.slice(0, 48) + '…' : s;
  };

  const getStatusColor = (s: string) => {
    const norm = s.toLowerCase();
    if (norm === 'pendiente' || norm === 'todo') return '#f87171';
    if (norm === 'en progreso' || norm === 'in_progress' || norm === 'en espera' || norm === 'waiting') return '#fbbf24';
    if (norm === 'completada' || norm === 'completed') return '#34d399';
    return 'transparent';
  };

  return (
    <>
      <div className="collection-page">
        <div className="collection-header">
          <div className="collection-header-title">
            <collection.icon size={24} style={{ color: collection.color }} />
            <h2>{collection.label}</h2>
          </div>
          <button 
            className="collection-new-btn"
            onClick={() => setEditing({})}
            style={{ background: collection.color }}
          >
            <Plus size={18} />
            <span>Nuevo</span>
          </button>
        </div>

        <div className="collection-body">
          {loading && <div className="list-loading">Cargando…</div>}
          {!loading && data?.items.length === 0 && (
            <div className="list-empty">No hay entradas todavía.</div>
          )}
          
          {!loading && collection.name === 'todo' && data?.items && (
            <div className="todo-list-sections">
              <div className="todo-section pending">
                {data.items
                  .filter(i => {
                    const s = String(i.status || 'Pendiente').toLowerCase();
                    return s !== 'completada' && s !== 'completed';
                  })
                  .map(item => (
                    <div 
                      key={String(item._id)} 
                      className="collection-row type-todo"
                      onClick={() => setEditing(item)}
                    >
                      <div className="list-row-content">
                        <div className="list-row-header">
                          <span className="list-row-title">
                            <span 
                              className="todo-status-dot" 
                              style={{ 
                                display: 'inline-block',
                                width: '8px', 
                                height: '8px', 
                                borderRadius: '50%', 
                                marginRight: '8px',
                                backgroundColor: getStatusColor(String(item.status || 'Pendiente'))
                              }} 
                            />
                            {shortTitle(item)}
                          </span>
                        </div>
                        <div className="list-row-meta">
                          {!!item.timestamp && (
                            <span className="list-row-date">{fmtDate(item.timestamp)}</span>
                          )}
                          {!!item.timestamp && (
                            <span className="list-row-time">{fmtTime(item.timestamp)}</span>
                          )}
                        </div>
                      </div>
                      <div className="list-row-actions">
                        <select 
                          className="status-selector-mini"
                          value={String(item.status || 'Pendiente')}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleStatusUpdate(item, e.target.value)}
                          style={{
                            fontSize: '10px',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            border: `1px solid ${collection.color}44`,
                            background: 'rgba(255,255,255,0.03)',
                            color: 'var(--text-secondary)',
                            marginRight: '8px',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          <option value="Pendiente">Pendiente</option>
                          <option value="En progreso">En progreso</option>
                          <option value="En espera">En espera</option>
                          <option value="Completada">Completada</option>
                        </select>
                        <Pencil size={14} style={{ color: collection.color, opacity: 0.5 }} />
                      </div>
                    </div>
                  ))
                }
              </div>
              
              {data.items.some(i => {
                  const s = String(i.status || 'Pendiente').toLowerCase();
                  return s === 'completada' || s === 'completed';
              }) && (
                <div className="todo-section completed-wrapper" style={{ marginTop: '20px' }}>
                  <button 
                    className="completed-toggle-btn"
                    onClick={() => setShowCompleted(!showCompleted)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      width: '100%', 
                      padding: '8px 0', 
                      fontSize: '13px', 
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      background: 'transparent',
                      border: 'none'
                    }}
                  >
                    {showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>Completadas ({
                        data.items.filter(i => {
                          const s = String(i.status || 'Pendiente').toLowerCase();
                          return s === 'completada' || s === 'completed';
                        }).length
                    })</span>
                  </button>
                  
                  {showCompleted && (
                    <div className="completed-list">
                       {data.items
                         .filter(i => {
                           const s = String(i.status || 'Pendiente').toLowerCase();
                           return s === 'completada' || s === 'completed';
                         })
                         .map(item => (
                            <div 
                              key={String(item._id)} 
                              className="collection-row type-todo"
                              onClick={() => setEditing(item)}
                            >
                              <div className="list-row-content">
                                <div className="list-row-header">
                                  <span className="list-row-title">
                                    <span 
                                      className="todo-status-dot" 
                                      style={{ 
                                        display: 'inline-block',
                                        width: '8px', 
                                        height: '8px', 
                                        borderRadius: '50%', 
                                        marginRight: '8px',
                                        backgroundColor: getStatusColor(String(item.status || 'Pendiente'))
                                      }} 
                                    />
                                    {shortTitle(item)}
                                  </span>
                                </div>
                                <div className="list-row-meta">
                                  {!!item.timestamp && (
                                    <span className="list-row-date">{fmtDate(item.timestamp)}</span>
                                  )}
                                  {!!item.timestamp && (
                                    <span className="list-row-time">{fmtTime(item.timestamp)}</span>
                                  )}
                                </div>
                              </div>
                              <div className="list-row-actions">
                                <select 
                                  className="status-selector-mini"
                                  value={String(item.status || 'Pendiente')}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => handleStatusUpdate(item, e.target.value)}
                                  style={{
                                    fontSize: '10px',
                                    padding: '2px 4px',
                                    borderRadius: '4px',
                                    border: `1px solid ${collection.color}44`,
                                    background: 'rgba(255,255,255,0.03)',
                                    color: 'var(--text-secondary)',
                                    marginRight: '8px',
                                    cursor: 'pointer',
                                    outline: 'none'
                                  }}
                                >
                                  <option value="Pendiente">Pendiente</option>
                                  <option value="En progreso">En progreso</option>
                                  <option value="En espera">En espera</option>
                                  <option value="Completada">Completada</option>
                                </select>
                                <Pencil size={14} style={{ color: collection.color, opacity: 0.5 }} />
                              </div>
                            </div>
                         ))
                       }
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!loading && (collection.name === 'gym' || collection.name === 'finance') && data?.items && (
            <div className="day-groups">
              {Object.entries(groupItemsByDay(data.items))
                .sort((a,b) => {
                  const timeA = new Date(a[1][0].timestamp as string).getTime();
                  const timeB = new Date(b[1][0].timestamp as string).getTime();
                  return timeB - timeA;
                })
                .map(([day, items], idx) => {
                  const isExpanded = expandedDays[day] ?? (idx < 2);
                  const unitLabel = collection.name === 'gym' ? 'ejercicios' : 'movimientos';
                  const dailyTotal = collection.name === 'finance'
                    ? items.reduce((sum, item) => {
                        const amt = Number(item.amount) || 0;
                        return item.type === 'ingreso' ? sum + amt : sum - amt;
                      }, 0)
                    : 0;

                  return (
                    <div key={day} className="day-group">
                      <button 
                        className="day-toggle-btn" 
                        onClick={() => toggleDay(day)}
                        style={{ borderLeft: `4px solid ${collection.color}` }}
                      >
                        <span className="day-label">{day}</span>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          {collection.name === 'finance' && (
                            <span className="day-total" style={{ color: dailyTotal >= 0 ? '#10b981' : '#f87171' }}>
                              {fmtCurrency(dailyTotal)}
                            </span>
                          )}
                          <span className="day-count">{items.length} {unitLabel}</span>
                          <span className="day-icon">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="day-content">
                          {items
                            .sort((a,b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime())
                            .map(item => (
                              <div 
                                key={String(item._id)} 
                                className="collection-row"
                                onClick={() => setEditing(item)}
                              >
                                <div className="list-row-content">
                                  <div className="list-row-header">
                                    <span className="list-row-title">{shortTitle(item)}</span>
                                    {collection.name === 'finance' && !!item.amount && (
                                      <span className="list-row-amount" style={{ color: item.type === 'ingreso' ? '#10b981' : '#f87171' }}>
                                        {item.type === 'ingreso' ? '+' : '-'} {fmtCurrency(item.amount)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="list-row-meta">
                                    {!!item.timestamp && (
                                      <span className="list-row-time">{fmtTime(item.timestamp)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="list-row-actions">
                                  <Pencil size={14} style={{ color: collection.color, opacity: 0.5 }} />
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}

          {!loading && !['gym', 'finance', 'todo'].includes(collection.name) &&
            (data?.items || [])
              .slice()
              .sort((a, b) => {
                if (collection.name === 'finance_categories') {
                  const aKey = String(a.name || '').toLowerCase().trim();
                  const bKey = String(b.name || '').toLowerCase().trim();
                  const aIsOtros = aKey === 'otros' || aKey === 'otro';
                  const bIsOtros = bKey === 'otros' || bKey === 'otro';
                  if (aIsOtros && !bIsOtros) return 1;
                  if (!aIsOtros && bIsOtros) return -1;
                  return aKey.localeCompare(bKey, 'es');
                }
                if (collection.name === 'gym_exercises') {
                  return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase(), 'es');
                }
                const timeA = new Date(a.timestamp as string || 0).getTime();
                const timeB = new Date(b.timestamp as string || 0).getTime();
                if (timeB !== timeA) return timeB - timeA;
                return String(b._id).localeCompare(String(a._id));
              })
              .map((item) => (
                <div 
                  key={String(item._id)} 
                  className="collection-row"
                  onClick={() => setEditing(item)}
                >
                  <div className="list-row-content">
                    <div className="list-row-header">
                      <span className="list-row-title">{shortTitle(item)}</span>
                    </div>
                    <div className="list-row-meta">
                      {!!item.timestamp && (
                        <span className="list-row-time">{fmtTime(item.timestamp)}</span>
                      )}
                    </div>
                  </div>
                  <div className="list-row-actions">
                    <Pencil size={14} style={{ color: collection.color, opacity: 0.5 }} />
                  </div>
                </div>
              ))}
        </div>

        {data && data.pages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹ Anterior
            </button>
            <span className="page-info">
              {page} / {data.pages}
            </span>
            <button
              className="page-btn"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente ›
            </button>
          </div>
        )}
      </div>

      {editing && (
        <EditPopup
          meta={collection}
          entry={editing}
          token={token}
          isNew={!editing._id}
          onClose={() => setEditing(null)}
          onSaved={() => load(page)}
          onDelete={(id) => {
            handleDelete(id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
