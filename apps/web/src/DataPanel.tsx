import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { 
  BookText,
  Wallet,
  Tag,
  Pencil, 
  Trash2, 
  Plus, 
  X, 
  ChevronDown,
  ChevronRight,
  ClipboardList as TodoIcon,
  Activity as GymIcon,
  Dumbbell as ExerciseIcon,
  LogOut,
  type LucideIcon 
} from 'lucide-react';
import {
  getEntries,
  updateEntry,
  deleteEntry,
} from './api/client';
import type { CollectionName, EntryPage } from './api/client';

// ────────────────────────────────────────────────────────
// Collection meta
// ────────────────────────────────────────────────────────
interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'datetime-local';
  options?: string[];
}

type LookupItem = { id: string; name: string; keywords?: string[] };

const normalizeSortKey = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const compareLookupAsc = (a: LookupItem, b: LookupItem): number =>
  normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name), 'es');

const compareCategoryAscWithOtrosLast = (a: LookupItem, b: LookupItem): number => {
  const aKey = normalizeSortKey(a.name);
  const bKey = normalizeSortKey(b.name);
  const aIsOtros = aKey === 'otros' || aKey === 'otro';
  const bIsOtros = bKey === 'otros' || bKey === 'otro';
  if (aIsOtros && !bIsOtros) return 1;
  if (!aIsOtros && bIsOtros) return -1;
  return aKey.localeCompare(bKey, 'es');
};

export interface CollectionMeta {
  name: CollectionName;
  label: string;
  icon: LucideIcon;
  color: string;
  fields: FieldDef[];
  /** Which field to use as a short title in the list */
  titleField: string;
}

export const COLLECTIONS: CollectionMeta[] = [
  {
    name: 'todo',
    label: 'Tareas',
    icon: TodoIcon,
    color: '#a855f7',
    titleField: 'title',
    fields: [
      { key: 'title', label: 'Tarea', type: 'text' },
      { key: 'content', label: 'Detalles', type: 'textarea' },
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        options: ['Pendiente', 'En progreso', 'Completada', 'En espera'],
      },
      { key: 'timestamp', label: 'Fecha', type: 'datetime-local' }
    ],
  },
  {
    name: 'finance',
    label: 'Finanzas',
    icon: Wallet,
    color: '#f59e0b',
    titleField: 'concept',
    fields: [
      {
        key: 'type',
        label: 'Tipo',
        type: 'select',
        options: ['gasto', 'ingreso'],
      },
      { key: 'amount', label: 'Monto', type: 'number' },
      {
        key: 'method',
        label: 'Método',
        type: 'select',
        options: ['efectivo', 'tdc banregio', 'tdc rappi', 'tdc banamex', 'transferencia', 'otro'],
      },
      {
        key: 'categoryId',
        label: 'Categoría',
        type: 'select',
      },
      { key: 'concept', label: 'Concepto', type: 'text' },
      { key: 'timestamp', label: 'Fecha y Hora', type: 'datetime-local' }
    ],
  },
  {
    name: 'gym',
    label: 'Gym',
    icon: GymIcon,
    color: '#10b981',
    titleField: 'exerciseName',
    fields: [
      { key: 'exerciseId', label: 'Ejercicio', type: 'select' },
      { key: 'weight', label: 'Peso / Tiempo', type: 'number' },
      {
        key: 'unit',
        label: 'Unidad',
        type: 'select',
        options: ['kg', 'lbs', 'min'],
      },
      { key: 'reps', label: 'Reps', type: 'number' },
      { key: 'sets', label: 'Sets', type: 'number' },
      {
        key: 'muscleGroup',
        label: 'Grupo Muscular',
        type: 'select',
        options: ['Brazo', 'Hombro', 'Pecho', 'Espalda', 'Pierna', 'Abdomen', 'Cardio', 'Completo'],
      },
      {
        key: 'type',
        label: 'Tipo',
        type: 'select',
        options: ['standard', 'top'],
      },
      { key: 'timestamp', label: 'Fecha y Hora', type: 'datetime-local' }
    ],
  },
  {
    name: 'finance_categories',
    label: 'Categorias',
    icon: Tag,
    color: '#ec4899',
    titleField: 'name',
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'keywords', label: 'Keywords', type: 'textarea' },
    ],
  },
  {
    name: 'gym_exercises',
    label: 'Exercises',
    icon: ExerciseIcon,
    color: '#06b6d4',
    titleField: 'name',
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      {
        key: 'muscleGroup',
        label: 'Grupo Muscular',
        type: 'select',
        options: ['Brazo', 'Hombro', 'Pecho', 'Espalda', 'Pierna', 'Abdomen', 'Cardio', 'Completo'],
      },
      { key: 'keywords', label: 'Sinónimos', type: 'textarea' },
    ],
  },
  {
    name: 'journal',
    label: 'Journal',
    icon: BookText,
    color: '#3b82f6',
    titleField: 'entry',
    fields: [
      { key: 'entry', label: 'Entry', type: 'textarea' },
      { key: 'timestamp', label: 'Fecha y Hora', type: 'datetime-local' }
    ],
  },
];

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────
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

const shortTitle = (item: Record<string, unknown>, meta: CollectionMeta): string => {
  const raw = item[meta.titleField];
  if (!raw) return String(item._id);
  const s = toTitleCase(String(raw));
  return s.length > 50 ? s.slice(0, 48) + '…' : s;
};

// ────────────────────────────────────────────────────────
// Edit Popup
// ────────────────────────────────────────────────────────
interface EditPopupProps {
  meta: CollectionMeta;
  entry: Record<string, unknown>;
  token: string;
  isNew?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}

function EditPopup({ meta, entry, token, isNew, onClose, onSaved, onDelete }: EditPopupProps) {
  const [financeCategories, setFinanceCategories] = useState<LookupItem[]>([]);
  const [gymExercises, setGymExercises] = useState<LookupItem[]>([]);
  const [form, setForm] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    meta.fields.forEach((f) => {
      if (meta.name === 'gym' && f.key === 'exerciseId') {
        const exercise = entry.exercise as { id?: string } | undefined;
        initial[f.key] = exercise?.id ?? entry.exerciseId ?? '';
        return;
      }
      if (meta.name === 'finance' && f.key === 'categoryId') {
        initial[f.key] = entry.categoryId ?? '';
        return;
      }
      if (f.key === 'timestamp') {
        const ts = (entry.timestamp as string | undefined) || new Date().toISOString();
        const d = new Date(ts);
        // Correctly get Monterrey time components
        const mtyParts = new Intl.DateTimeFormat('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
          timeZone: 'America/Monterrey'
        }).formatToParts(d);
        
        const getP = (t: string) => mtyParts.find(p => p.type === t)?.value || '';
        initial[f.key] = `${getP('year')}-${getP('month')}-${getP('day')}T${getP('hour')}:${getP('minute')}`;
        return;
      }
      if ((meta.name === 'finance_categories' || meta.name === 'gym_exercises') && f.key === 'keywords') {
        const keywords = entry.keywords as unknown;
        if (Array.isArray(keywords)) {
          initial[f.key] = keywords.join('\n');
          return;
        }
      }

      initial[f.key] = entry[f.key] ?? '';
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadLookups = async () => {
      try {
        if (meta.name === 'finance') {
          const res = await getEntries('finance_categories', token, 1, 500);
          if (cancelled) return;
          const items = res.items
            .map((item) => ({
              id: String(item._id),
              name: String(item.name || ''),
              keywords: Array.isArray(item.keywords) ? (item.keywords as string[]) : undefined,
            }))
            .filter((item) => item.name);
          items.sort(compareCategoryAscWithOtrosLast);
          setFinanceCategories(items);
        }

        if (meta.name === 'gym') {
          const res = await getEntries('gym_exercises', token, 1, 500);
          if (cancelled) return;
          const items = res.items
            .map((item) => ({
              id: String(item._id),
              name: String(item.name || ''),
              keywords: Array.isArray(item.keywords) ? (item.keywords as string[]) : undefined,
            }))
            .filter((item) => item.name);
          items.sort(compareLookupAsc);
          setGymExercises(items);
        }
      } catch {
        // Ignore lookup errors; UI falls back to free text values.
      }
    };

    loadLookups();
    return () => {
      cancelled = true;
    };
  }, [meta.name, token]);

  const handleChange = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<Record<string, unknown>[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);

  const loadHistory = useCallback(async (p: number, append = false) => {
    if (!isNew && meta.name === 'gym_exercises') {
      setHistoryLoading(true);
      try {
        const res = await getEntries('gym', token, p, 5, { exerciseId: String(entry._id) });
        setHistoryItems(prev => append ? [...prev, ...res.items] : res.items);
        setHistoryTotal(res.total);
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        setHistoryLoading(false);
      }
    }
  }, [entry._id, isNew, meta.name, token]);

  useEffect(() => {
    loadHistory(1);
  }, [loadHistory]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Normalize text fields to lowercase/no-accents for DB consistency in lookups
      const normalizedForm = { ...form };
      const isLookup = ['finance_categories', 'finance_businesses', 'gym_exercises'].includes(meta.name);
      
      meta.fields.forEach(f => {
        if ((f.type === 'text' || f.type === 'textarea') && typeof normalizedForm[f.key] === 'string') {
          const raw = normalizedForm[f.key] as string;
          if (isLookup && f.key === 'name') {
             normalizedForm[f.key] = raw.trim();
          } else if (meta.name === 'journal' || meta.name === 'todo') {
            // Journal entries and Todo allow mixed case
            normalizedForm[f.key] = raw.trim();
          } else {
            normalizedForm[f.key] = raw.toLowerCase().trim();
          }
        }
      });

      if ((meta.name === 'finance_categories' || meta.name === 'gym_exercises') && typeof normalizedForm.keywords === 'string') {
        const parts = (normalizedForm.keywords as string)
          .split(/[\n,]+/)
          .map((v) => v.trim())
          .filter(Boolean);
        normalizedForm.keywords = parts;
      }

      if (meta.name === 'finance' && typeof normalizedForm.categoryId === 'string') {
        const category = financeCategories.find((c) => c.id === normalizedForm.categoryId);
        if (category) normalizedForm.categoryName = category.name;
      }

      if (meta.name === 'gym' && typeof normalizedForm.exerciseId === 'string') {
        const exercise = gymExercises.find((e) => e.id === normalizedForm.exerciseId);
        if (exercise) {
          normalizedForm.exerciseName = exercise.name;
          normalizedForm.exercise = { id: exercise.id, name: exercise.name };
        }
        delete normalizedForm.exerciseId;
      }

      if (normalizedForm.timestamp) {
        // Enforce parsing as Monterrey time (-06:00)
        normalizedForm.timestamp = new Date(`${normalizedForm.timestamp}:00-06:00`).toISOString();
      }

      if (isNew) {
        await updateEntry(meta.name, 'new', normalizedForm, token);
      } else {
        await updateEntry(meta.name, String(entry._id), normalizedForm, token);
      }
      onSaved();
      onClose();
    } catch {
      setError('Error al guardar. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const hasMoreHistory = historyItems.length < historyTotal;

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-box edit-popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-header" style={{ borderColor: meta.color }}>
          <div className="popup-header-title" style={{ color: meta.color }}>
            <meta.icon size={20} />
            <span>{isNew ? 'Nuevo' : 'Editar'} — {meta.label}</span>
          </div>
          <button className="popup-close-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="edit-form">
          {meta.fields.map((f) => (
            <div key={f.key} className="edit-field">
              <label className="edit-label">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea
                  className="edit-input edit-textarea"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  rows={4}
                />
              ) : f.type === 'select' ? (
                <select
                  className="edit-input edit-select"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                >
                  {meta.name === 'finance' && f.key === 'categoryId' ? (
                    <>
                      <option value="">Selecciona...</option>
                      {financeCategories.map((c) => (
                        <option key={c.id} value={c.id}>{toTitleCase(c.name)}</option>
                      ))}
                    </>
                  ) : meta.name === 'gym' && f.key === 'exerciseId' ? (
                    <>
                      <option value="">Selecciona...</option>
                      {gymExercises.map((ex) => (
                        <option key={ex.id} value={ex.id}>{toTitleCase(ex.name)}</option>
                      ))}
                    </>
                  ) : (
                    <>
                      {f.options?.map((o) => (
                        <option key={o} value={o}>{toTitleCase(o)}</option>
                      ))}
                    </>
                  )}
                </select>
              ) : f.type === 'number' ? (
                <input
                  className="edit-input"
                  type="number"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => handleChange(f.key, parseFloat(e.target.value))}
                />
              ) : f.type === 'datetime-local' ? (
                <input
                  className="edit-input"
                  type="datetime-local"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                />
              ) : (
                <input
                  className="edit-input"
                  type="text"
                  value={String(form[f.key] ?? '')}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                />
              )}
            </div>
          ))}

          {meta.name === 'gym_exercises' && !isNew && (
            <div className="edit-history">
              <div className="history-title">
                <ExerciseIcon size={14} />
                <span>Historial Reciente</span>
              </div>
              <div className="history-list">
                {historyItems.map((h: any) => (
                  <div key={String(h._id)} className="history-row">
                    <div className="history-row-main">
                      <span className="history-weight">
                        {h.weight}{h.unit}
                      </span>
                      <span className="history-reps">
                        {h.sets}x{h.reps} {h.type === 'top' ? '🔥' : ''}
                      </span>
                    </div>
                    <span className="history-date">
                      {new Date(h.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                  </div>
                ))}
                {historyItems.length === 0 && !historyLoading && (
                  <div className="list-empty" style={{ padding: '10px 0', fontSize: '12px' }}>Sin registros.</div>
                )}
                {historyLoading && <div className="list-loading" style={{ fontSize: '12px' }}>Cargando...</div>}
                {hasMoreHistory && !historyLoading && (
                  <button 
                    className="history-more-btn" 
                    onClick={() => {
                        const nextPage = historyPage + 1;
                        setHistoryPage(nextPage);
                        loadHistory(nextPage, true);
                    }}
                  >
                    Ver más resultados ({historyTotal - historyItems.length})
                  </button>
                )}
              </div>
            </div>
          )}

          {error && <p className="edit-error">{error}</p>}

          <div className="edit-actions">
            {!isNew && (
              <button 
                className="cancel-btn" 
                onClick={() => {
                  if (window.confirm('¿Eliminar este registro?')) {
                    onDelete(String(entry._id));
                    onClose();
                  }
                }}
                title="Eliminar"
                style={{ marginRight: 'auto', color: '#f87171' }}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button className="cancel-btn" onClick={onClose} disabled={saving}>Cancelar</button>
            <button
              className="save-btn"
              style={{ background: meta.color }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// List Row Component
// ────────────────────────────────────────────────────────
interface ListRowProps {
  item: Record<string, unknown>;
  meta: CollectionMeta;
  onEdit: (item: Record<string, unknown>) => void;
  onUpdateStatus?: (item: Record<string, unknown>, newStatus: string) => void;
}

function ListRow({ item, meta, onEdit, onUpdateStatus }: ListRowProps) {
  const isTodo = meta.name === 'todo';
  const status = String(item.status || (isTodo ? 'Pendiente' : ''));
  
  let rowStyle: CSSProperties = {};
  if (isTodo) {
    if (status.toLowerCase() === 'completada' || status === 'completed') {
      rowStyle.opacity = 0.5;
    }
  }

  const getStatusColor = (s: string) => {
    const norm = s.toLowerCase();
    if (norm === 'pendiente' || norm === 'todo') return '#f87171'; // Red
    if (norm === 'en progreso' || norm === 'in_progress' || norm === 'en espera' || norm === 'waiting') return '#fbbf24'; // Yellow
    if (norm === 'completada' || norm === 'completed') return '#34d399'; // Green
    return 'transparent';
  };

  return (
    <div 
      key={String(item._id)} 
      className={`list-row ${isTodo ? 'type-todo' : ''}`}
      onClick={() => onEdit(item)}
      style={{ cursor: 'pointer', ...rowStyle }}
    >
      <div className="list-row-content">
        <div className="list-row-header">
          <span className="list-row-title">
            {isTodo && (
              <span 
                className="todo-status-dot" 
                style={{ 
                  display: 'inline-block',
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%', 
                  marginRight: '8px',
                  backgroundColor: getStatusColor(status)
                }} 
              />
            )}
            {shortTitle(item, meta)}
          </span>
        </div>
        <div className="list-row-meta">
          {meta.name !== 'gym' && meta.name !== 'finance' && !!item.timestamp && (
            <span className="list-row-date">{fmtDate(item.timestamp)}</span>
          )}
          {meta.name !== 'journal' && !!item.timestamp && (
            <span className="list-row-time">{fmtTime(item.timestamp)}</span>
          )}
        </div>
      </div>
      {meta.name === 'finance' && !!item.amount && (
        <span className="list-row-amount" style={{ color: item.type === 'ingreso' ? '#10b981' : '#f87171' }}>
          {item.type === 'ingreso' ? '+' : '-'} {fmtCurrency(item.amount)}
        </span>
      )}
      <div className="list-row-actions">
        {isTodo && onUpdateStatus && (
          <select 
            className="status-selector-mini"
            value={status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdateStatus(item, e.target.value)}
            style={{
              fontSize: '10px',
              padding: '2px 4px',
              borderRadius: '4px',
              border: `1px solid ${meta.color}44`,
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
        )}
        <Pencil size={14} style={{ color: meta.color, opacity: 0.5 }} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// List Popup
// ────────────────────────────────────────────────────────
interface ListPopupProps {
  meta: CollectionMeta;
  token: string;
  onClose: () => void;
}

function ListPopup({ meta, token, onClose }: ListPopupProps) {
  const [data, setData] = useState<EntryPage | null>(null);
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
        const res = await getEntries(meta.name, token, p, 50);
        setData(res);
      } finally {
        setLoading(false);
      }
    },
    [meta.name, token]
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    try {
      await deleteEntry(meta.name, id, token);
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

  return (
    <>
      <div className="popup-overlay" onClick={onClose}>
        <div className="popup-box list-popup" onClick={(e) => e.stopPropagation()}>
          <div className="popup-header" style={{ borderColor: meta.color }}>
            <div className="popup-header-title" style={{ color: meta.color }}>
              <meta.icon size={22} />
              <span>
                {meta.label}
                {data ? ` (${data.total} entradas)` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className="save-btn" 
                title="Nuevo" 
                onClick={() => setEditing({})} 
                style={{ background: meta.color, padding: '6px 14px' }}
              >
                <Plus size={16} style={{ marginRight: '6px' }} /> Nuevo
              </button>
              <button className="popup-close-btn" onClick={onClose}><X size={18} /></button>
            </div>
          </div>

          <div className="list-body">
            {loading && <div className="list-loading">Cargando…</div>}
            {!loading && data?.items.length === 0 && (
              <div className="list-empty">No hay entradas todavía.</div>
            )}
            
            {!loading && meta.name === 'todo' && data?.items && (
              <div className="todo-list-sections">
                <div className="todo-section pending">
                  {data.items
                    .filter(i => {
                      const s = String(i.status || 'Pendiente').toLowerCase();
                      return s !== 'completada' && s !== 'completed';
                    })
                    .map(item => (
                      <ListRow 
                        key={String(item._id)} 
                        item={item} 
                        meta={meta} 
                        onEdit={setEditing} 
                        onUpdateStatus={handleStatusUpdate}
                      />
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
                              <ListRow 
                                key={String(item._id)} 
                                item={item} 
                                meta={meta} 
                                onEdit={setEditing} 
                                onUpdateStatus={handleStatusUpdate}
                              />
                           ))
                         }
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!loading && (meta.name === 'gym' || meta.name === 'finance') && data?.items && (
              <div className="day-groups">
                {Object.entries(groupItemsByDay(data.items))
                  .sort((a,b) => {
                    const timeA = new Date(a[1][0].timestamp as string).getTime();
                    const timeB = new Date(b[1][0].timestamp as string).getTime();
                    return timeB - timeA;
                  })
                  .map(([day, items], idx) => {
                    const isExpanded = expandedDays[day] ?? (idx < 2);
                    const unitLabel = meta.name === 'gym' ? 'ejercicios' : 'movimientos';
                    const dailyTotal = meta.name === 'finance'
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
                          style={{ borderLeft: `4px solid ${meta.color}` }}
                        >
                          <span className="day-label">{day}</span>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            {meta.name === 'finance' && (
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
                                <ListRow key={String(item._id)} item={item} meta={meta} onEdit={setEditing} />
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                }
              </div>
            )}

            {!loading && !['gym', 'finance', 'todo'].includes(meta.name) &&
              (data?.items || [])
                .slice()
                .sort((a, b) => {
                  if (meta.name === 'finance_categories') {
                    return compareCategoryAscWithOtrosLast(
                      { id: String(a._id), name: String(a.name || '') },
                      { id: String(b._id), name: String(b.name || '') }
                    );
                  }
                  if (meta.name === 'gym_exercises') {
                    return compareLookupAsc(
                      { id: String(a._id), name: String(a.name || '') },
                      { id: String(b._id), name: String(b.name || '') }
                    );
                  }
                  const timeA = new Date(a.timestamp as string || 0).getTime();
                  const timeB = new Date(b.timestamp as string || 0).getTime();
                  if (timeB !== timeA) return timeB - timeA;
                  return String(b._id).localeCompare(String(a._id));
                })
                .map((item) => (
                  <ListRow key={String(item._id)} item={item} meta={meta} onEdit={setEditing} />
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
      </div>

      {editing && (
        <EditPopup
          meta={meta}
          entry={editing}
          token={token}
          isNew={!editing._id}
          onClose={() => setEditing(null)}
          onSaved={() => load(page)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}


interface DataPanelProps {
  token: string;
  active: CollectionMeta | null;
  setActive: (meta: CollectionMeta | null) => void;
  onLogout: () => void;
}

export function DataPanel({ token, active, setActive, onLogout }: DataPanelProps) {

  return (
    <>
      <aside className="data-panel">
        {COLLECTIONS.map((col) => (
          <button
            key={col.name}
            className="data-panel-btn"
            title={col.label}
            style={{ '--accent': col.color } as unknown as CSSProperties}
            onClick={() => setActive(col)}
          >
            <col.icon style={{ color: col.color }} />
            <span className="data-panel-btn-label">{col.label}</span>
          </button>
        ))}
        <button
          className="data-panel-btn logout"
          title="Cerrar Sesión"
          onClick={onLogout}
          style={{ '--accent': '#f87171', marginTop: 'auto' } as unknown as CSSProperties}
        >
          <LogOut />
          <span className="data-panel-btn-label">Logout</span>
        </button>
      </aside>

      {active && (
        <ListPopup
          meta={active}
          token={token}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
