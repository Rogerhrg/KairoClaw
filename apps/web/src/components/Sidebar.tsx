import { useState } from 'react';
import { 
  Menu,
  Layout,
  Wallet,
  Dumbbell,
  ClipboardList,
  BookText,
  Activity,
  History,
  Tag,
  MessageSquare,
  LogOut,
  Cloud,
  CloudRain,
  Sun,
  Moon,
  CloudMoon,
  X
} from 'lucide-react';
import { COLLECTIONS, type CollectionMeta } from '../DataPanel';

interface WeatherData {
  temp: number;
  description: string;
  icon: 'sun' | 'cloud' | 'cloud-rain' | 'moon' | 'cloud-moon';
}

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  collectionName?: CollectionMeta['name'];
  isGroup?: boolean;
  children?: SidebarItem[];
  comingSoon?: boolean;
}

interface SidebarProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  activeCollection: CollectionMeta | null;
  setActiveCollection: (collection: CollectionMeta | null) => void;
  onLogout: () => void;
  weather: WeatherData | null;
}

const getWeatherIcon = (icon: WeatherData['icon']) => {
  switch (icon) {
    case 'sun': return Sun;
    case 'cloud': return Cloud;
    case 'cloud-rain': return CloudRain;
    case 'moon': return Moon;
    case 'cloud-moon': return CloudMoon;
    default: return Cloud;
  }
};

export function Sidebar({ 
  currentPage, 
  setCurrentPage, 
  activeCollection, 
  setActiveCollection,
  onLogout,
  weather 
}: SidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);



  const handleNavigation = (itemId: string, collectionName?: CollectionMeta['name']) => {
    if (collectionName) {
      const collection = COLLECTIONS.find(c => c.name === collectionName) || null;
      setActiveCollection(collection);
      setCurrentPage(itemId);
    } else {
      setActiveCollection(null);
      setCurrentPage(itemId);
    }
    setIsMobileOpen(false);
  };

  const navItems: SidebarItem[] = [
    { id: 'inicio', label: 'Inicio', icon: MessageSquare },
    {
      id: 'planes',
      label: 'Planes',
      icon: Layout,
      isGroup: true,
      children: [
        { id: 'tareas', label: 'Tareas', icon: ClipboardList, collectionName: 'todo' },
        { id: 'journal', label: 'Journal', icon: BookText, collectionName: 'journal' },
      ],
    },
    {
      id: 'finanzas',
      label: 'Finanzas',
      icon: Wallet,
      isGroup: true,
      children: [
        { id: 'finanzas-logs', label: 'Gastos', icon: History, collectionName: 'finance' },
        { id: 'categorias', label: 'Categorías', icon: Tag, collectionName: 'finance_categories' },
      ],
    },
    {
      id: 'fitness',
      label: 'Fitness',
      icon: Dumbbell,
      isGroup: true,
      children: [
        { id: 'gym-logs', label: 'Historial', icon: Activity, collectionName: 'gym' },
        { id: 'ejercicios', label: 'Ejercicios', icon: Dumbbell, collectionName: 'gym_exercises' },
      ],
    },
  ];

  const WeatherIcon = weather ? getWeatherIcon(weather.icon) : Cloud;

  return (
    <>
      {/* Mobile Menu Button */}
      <button 
        className="mobile-menu-btn"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="sidebar-overlay"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo" onClick={() => handleNavigation('inicio')}>
            <img src="/assets/img/header.jpg" alt="AutoClaw" className="sidebar-logo-img" />
          </div>
        </div>

        {weather && (
          <div className="sidebar-weather">
            <WeatherIcon size={20} className="sidebar-weather-icon" />
            <span className="sidebar-weather-temp">{Math.round(weather.temp)}°C</span>
            <span className="sidebar-weather-desc">{weather.description}</span>
          </div>
        )}

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id || (item.collectionName && activeCollection?.name === item.collectionName);
            
            if (item.isGroup) {
              return (
                <div key={item.id} className="sidebar-group">
                  <div className="sidebar-group-label">
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                  {item.children && (
                    <div className="sidebar-group-children">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const isChildActive = currentPage === child.id || (child.collectionName && activeCollection?.name === child.collectionName);
                        
                        if (child.comingSoon) {
                          return (
                            <div 
                              key={child.id}
                              className="sidebar-item coming-soon"
                            >
                              <ChildIcon size={18} />
                              <span>{child.label}</span>
                            </div>
                          );
                        }
                        
                        return (
                          <button 
                            key={child.id}
                            className={`sidebar-item ${isChildActive ? 'active' : ''}`}
                            onClick={() => handleNavigation(child.id, child.collectionName)}
                          >
                            <ChildIcon size={18} />
                            <span>{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <button 
                key={item.id}
                data-id={item.id}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => handleNavigation(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-logout-btn" onClick={onLogout}>
            <LogOut size={18} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}
