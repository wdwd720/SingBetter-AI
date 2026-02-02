import { useAuth } from "@/hooks/use-auth";
import { BottomNav } from "@/components/BottomNav";
import { LogOut, User, Settings, Bell, Shield } from "lucide-react";

export default function Profile() {
  const { user, logout } = useAuth();

  const menuItems = [
    { icon: User, label: "Account Information" },
    { icon: Bell, label: "Notifications" },
    { icon: Shield, label: "Privacy & Security" },
    { icon: Settings, label: "App Settings" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="px-6 py-8">
        <h1 className="text-2xl font-display font-bold">Profile</h1>
      </header>

      <main className="px-6">
        <div className="flex flex-col items-center mb-8">
          <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary to-secondary p-[3px] mb-4">
            <img 
              src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${user?.firstName || 'User'}&background=random`} 
              alt="Profile" 
              className="w-full h-full rounded-full object-cover bg-background"
            />
          </div>
          <h2 className="text-xl font-bold">{user?.firstName} {user?.lastName}</h2>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>

        <div className="bg-card border border-white/5 rounded-3xl overflow-hidden mb-6">
          {menuItems.map((item, i) => (
            <div 
              key={i}
              className="p-4 flex items-center gap-4 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0"
            >
              <item.icon className="w-5 h-5 text-muted-foreground" />
              <span className="font-medium">{item.label}</span>
            </div>
          ))}
        </div>

        <button 
          onClick={() => logout()}
          className="w-full py-4 rounded-2xl border border-destructive/20 text-destructive font-bold flex items-center justify-center gap-2 hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </main>
      <BottomNav />
    </div>
  );
}
