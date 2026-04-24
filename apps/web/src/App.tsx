import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react';
import { Trash2, Send, Loader2, RotateCw, LogOut } from 'lucide-react';
import { sendChat, getSettings, updateSettings, getHistory, deleteHistoryMessage } from './api/client';
import { DataPanel, COLLECTIONS, type CollectionMeta } from './DataPanel';
import './index.css';

interface ChatMessage {
  _id?: string;
  role: 'user' | 'assistant';
  content: string | { text: string; code?: string };
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth_token'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [preferredModel, setPreferredModel] = useState<string>('google/gemma-4-31b-it:free');
  const [activeCollection, setActiveCollection] = useState<CollectionMeta | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesBoxRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  useEffect(() => {
    if (token) {
        getSettings(token)
            .then(data => {
                if (data.preferredModel) setPreferredModel(data.preferredModel);
            })
            .catch(console.error);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const loadInitialHistory = async () => {
      setLoadingHistory(true);
      try {
        const page = await getHistory(token, undefined, 30);
        if (cancelled) return;
        const items = page.items.filter((m) => m.role === 'user' || m.role === 'assistant');
        setMessages(
          items.map((m) => ({
            _id: m._id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))
        );
        setHistoryCursor(page.nextCursor);
        setHistoryHasMore(page.hasMore);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    loadInitialHistory();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim() && password.trim()) {
      const basicToken = btoa(`${email.trim()}:${password.trim()}`);
      localStorage.setItem('auth_token', basicToken);
      setToken(basicToken);
    }
  };

  const handleRefresh = async () => {
    if (!token || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const page = await getHistory(token, undefined, 30);
      const items = page.items.filter((m) => m.role === 'user' || m.role === 'assistant');
      setMessages(
        items.map((m) => ({
          _id: m._id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      );
      setHistoryCursor(page.nextCursor);
      setHistoryHasMore(page.hasMore);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setMessages([]);
    setHistoryCursor(null);
    setHistoryHasMore(false);
  };

  const loadMoreHistory = async () => {
    if (!token || loadingHistory || !historyHasMore || !historyCursor) return;
    const box = messagesBoxRef.current;
    const prevScrollHeight = box?.scrollHeight ?? 0;

    setLoadingHistory(true);
    try {
      const page = await getHistory(token, historyCursor, 30);
      const items = page.items.filter((m) => m.role === 'user' || m.role === 'assistant');
      setMessages((prev) => [
        ...items.map((m) => ({
          _id: m._id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        ...prev,
      ]);
      setHistoryCursor(page.nextCursor);
      setHistoryHasMore(page.hasMore);

      requestAnimationFrame(() => {
        const nextScrollHeight = box?.scrollHeight ?? 0;
        if (box) box.scrollTop = nextScrollHeight - prevScrollHeight;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as any);
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !token) return;

    const userMessage = inputValue.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInputValue('');
    setLoading(true);

    try {
      const response = await sendChat(userMessage, token);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err: any) {
      if (err.message === 'Unauthorized') {
        handleLogout();
        alert('Session expired or incorrect password.');
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error communicating with AI.' }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    if (!token || !window.confirm('¿Eliminar este mensaje?')) return;
    try {
      await deleteHistoryMessage(id, token);
      setMessages((prev) => prev.filter((m) => m._id !== id));
    } catch (e) {
      console.error(e);
      alert('Error deleting message.');
    }
  };

  if (!token) {
    return (
      <div className="login-container">
        <form className="login-box" onSubmit={handleLogin}>
          <h2>AutoClaw</h2>
          <input
            type="email"
            placeholder="Enter email..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            placeholder="Enter password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Login</button>
        </form>
      </div>
    );
  }

  const handleModelChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setPreferredModel(newModel);
    if (token) {
        updateSettings(newModel, token).catch(console.error);
    }
  };

  return (
    <div className="app-layout">
      <div className="chat-container">
        <header className="chat-header">
          <div className="chat-header-main">
            <div className="chat-header-brand" onClick={handleRefresh}>
              <img src="/assets/img/header.jpg" alt="Kairo" className="header-logo clickable" />
            </div>
            
            <div className="chat-header-controls">
              <button 
                className="header-action-btn logout-btn" 
                onClick={handleLogout} 
                title="Cerrar Sesión"
              >
                <LogOut size={18} />
              </button>
              <select value={preferredModel} onChange={handleModelChange} className="model-selector">
                <option value="google/gemma-4-31b-it:free">Gemma 4 31B (Free)</option>
                <option value="nvidia/nemotron-3-super-120b-a12b:free">Nemotron 70B</option>
                <option value="moonshotai/kimi-k2.5">Kimi 2.5</option>
                <option value="minimaxai/minimax-m2.7">Minimax 2.7</option>
                <option value="meta/llama3-70b-instruct">Llama 3 70B</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
              <button onClick={handleRefresh} className="refresh-btn" title="Refrescar mensajes">
                <RotateCw size={16} className={loadingHistory ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          
          <div className="header-mobile-nav">
            {COLLECTIONS.map((col) => (
              <button
                key={col.name}
                className="mobile-nav-btn"
                onClick={() => setActiveCollection(col)}
                title={col.label}
                style={{ color: col.color }}
              >
                <col.icon size={20} />
              </button>
            ))}
          </div>
        </header>

        <div className="chat-main">
          <div className="chat-feed">
            <div
              className="chat-messages"
              ref={messagesBoxRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop <= 0) {
                  loadMoreHistory();
                }
              }}
            >
              {historyHasMore && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
                  <button
                    onClick={loadMoreHistory}
                    disabled={loadingHistory}
                    style={{ opacity: loadingHistory ? 0.6 : 1 }}
                  >
                    {loadingHistory ? 'Cargando...' : 'Cargar más'}
                  </button>
                </div>
              )}
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#8b949e', marginTop: '40px' }}>
                  Ready to assist. Send a message to begin.
                </div>
              )}
              {messages.map((msg, idx) => {
                const isObject = typeof msg.content === 'object' && msg.content !== null;
                const text = isObject ? (msg.content as any).text : msg.content;
                const code = isObject ? (msg.content as any).code : null;

                return (
                  <div key={msg._id || idx} className={`message ${msg.role}`}>
                    <div className="message-header">
                      {msg._id && (
                        <button 
                          className="message-delete-btn" 
                          onClick={() => handleDeleteMessage(msg._id!)}
                          title="Eliminar mensaje"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <div className="message-content">
                      <div dangerouslySetInnerHTML={{ __html: String(text).replace(/\n/g, '<br />') }} />
                      {code && (
                        <pre className="code-block">
                          <code>{code}</code>
                        </pre>
                      )}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="message assistant" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Loader2 className="animate-spin" size={16} />
                  <span>Thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="chat-input-area" onSubmit={handleSend}>
              <textarea
                ref={textareaRef}
                placeholder="Type a message..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                rows={1}
              />
              <button type="submit" disabled={loading || !inputValue.trim()} className="send-btn">
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
              </button>
            </form>
          </div>

          <DataPanel 
            token={token!} 
            active={activeCollection} 
            setActive={setActiveCollection} 
            onLogout={handleLogout} 
          />
        </div>
      </div>
    </div>
  );
}

export default App;
