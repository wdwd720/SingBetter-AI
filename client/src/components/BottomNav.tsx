import { Link, useLocation } from "wouter";
import { Mic2, LayoutDashboard, Trophy, User } from "lucide-react";
import { clsx } from "clsx";

export function BottomNav() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Home" },
    { href: "/live-coaching", icon: Mic2, label: "Coach" },
    { href: "/progress", icon: Trophy, label: "Progress" },
    { href: "/profile", icon: User, label: "Profile" },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background/85 backdrop-blur-xl border-t border-white/10 pb-safe z-50">
      <div className="flex justify-around items-center h-16 max-w-md mx-auto px-2">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={clsx(
                  "flex flex-col items-center justify-center w-16 h-full space-y-1 cursor-pointer rounded-xl transition-all duration-200",
                  isActive ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                <item.icon
                  className={clsx(
                    "w-5.5 h-5.5 transition-transform duration-200",
                    isActive && "scale-110 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
