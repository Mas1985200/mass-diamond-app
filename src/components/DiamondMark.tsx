import React, { useState } from 'react';
import DiamondMark from './DiamondMark'; // مسیر کامپوننت الماس خودتون

export default function MassDiamondDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-[#050a08] text-white font-sans overflow-hidden relative">
      
      {/* ================= سایدبار (سمت چپ) ================= */}
      {/* در موبایل مخفی میشه و با دکمه منو باز میشه */}
      <aside className={`fixed md:relative z-50 w-64 h-full bg-[#0a1410] border-r border-[#1a2e24] flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        
        {/* لوگو و نام */}
        <div className="p-4 flex items-center gap-3 border-b border-[#1a2e24]">
          <div className="w-8 h-8"><DiamondMark size={32} /></div>
          <div>
            <h2 className="text-sm font-bold text-white">Mass Diamond</h2>
            <p className="text-[10px] text-gray-500">Intelligent Assistant</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden ml-auto text-gray-400">✕</button>
        </div>

        {/* منوی اصلی */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#1a2e24] text-[#39FF88] rounded-lg text-sm font-medium transition-colors">
            <span>🏠</span> Home
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-[#0d1f17] rounded-lg text-sm transition-colors">
            <span>💬</span> Chat
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-[#0d1f17] rounded-lg text-sm transition-colors">
            <span>🔍</span> Search
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-[#0d1f17] rounded-lg text-sm transition-colors">
            <span>🎓</span> Learning
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-[#0d1f17] rounded-lg text-sm transition-colors">
            <span>🖼️</span> Media
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-[#0d1f17] rounded-lg text-sm transition-colors">
            <span>🧰</span> Tools
          </button>
        </div>

        {/* چت‌های اخیر */}
        <div className="p-4 border-t border-[#1a2e24]">
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Recent Chats</p>
          <div className="space-y-2 text-sm text-gray-400">
            <div className="flex justify-between items-center hover:text-white cursor-pointer"><span>چطور شروع کنم؟</span><span className="text-[10px]">2m</span></div>
            <div className="flex justify-between items-center hover:text-white cursor-pointer"><span>ساختار پروژه</span><span className="text-[10px]">1h</span></div>
            <div className="flex justify-between items-center hover:text-white cursor-pointer"><span>تنظیمات امنیتی</span><span className="text-[10px]">1d</span></div>
          </div>
        </div>

        {/* پایین سایدبار */}
        <div className="p-4 border-t border-[#1a2e24] space-y-2">
          <button className="w-full flex items-center gap-3 text-gray-400 hover:text-white text-sm"><span>⚙️</span> Settings</button>
          <button className="w-full flex items-center gap-3 text-gray-400 hover:text-white text-sm"><span>🌐</span> English</button>
        </div>
      </aside>

      {/* ================= بخش اصلی (سمت راست) ================= */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* هدر بالای صفحه */}
        <header className="flex justify-between items-center p-4 border-b border-[#1a2e24] md:border-none">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden text-2xl text-gray-400">☰</button>
          <div className="flex-1"></div>
          <div className="flex items-center gap-3">
            <button className="text-gray-400 hover:text-white text-lg">☀️</button>
            <div className="w-8 h-8 rounded-full bg-[#1a2e24] flex items-center justify-center text-[#39FF88] text-xs font-bold">A</div>
          </div>
        </header>

        {/* ================= محتوای وسط (خوش‌آمدگویی و دکمه‌ها) ================= */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 relative z-10">
          
          {/* افکت نور سبز پس‌زمینه */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-[#39FF88] opacity-[0.04] blur-[120px] rounded-full pointer-events-none" />

          {/* الماس */}
          <div className="mb-6">
            <DiamondMark size={140} />
          </div>

          {/* متن خوش‌آمدگویی */}
          <h1 className="text-3xl md:text-4xl font-bold text-center mb-2">
            Hello, I'm <span className="text-[#39FF88]">Mass Diamond</span>
          </h1>
          <p className="text-gray-400 text-sm md:text-base mb-8 text-center">
            Your Intelligent Assistant for a Bigger Tomorrow
          </p>

          {/* دکمه‌های میانبر (۶ دکمه) */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full max-w-2xl px-4">
            <QuickButton icon="💬" text="Ask me anything" />
            <QuickButton icon="🔍" text="Search the web" />
            <QuickButton icon="🖼️" text="Create images" />
            <QuickButton icon="🎓" text="Get learning help" />
            <QuickButton icon="🛍️" text="Find products" />
            <QuickButton icon="💡" text="Explore more" />
          </div>
        </div>

        {/* ================= نوار ورودی چت (پایین) ================= */}
        <div className="p-4 pb-6 w-full max-w-3xl mx-auto z-20">
          <div className="relative flex items-center bg-[#0d1f17] border border-[#1a2e24] rounded-2xl px-4 py-3 shadow-[0_0_20px_rgba(0,0,0,0.5)] focus-within:border-[#39FF88] transition-all">
            <button className="text-gray-400 hover:text-[#39FF88] mr-3 text-lg">📎</button>
            <input 
              type="text" 
              placeholder="How can I help you?" 
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 text-sm"
            />
            <button className="text-gray-400 hover:text-white mx-2">🎤</button>
            <button className="w-8 h-8 rounded-full bg-[#39FF88] flex items-center justify-center text-black hover:bg-[#2ae07a] transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}

// کامپوننت کوچک برای دکمه‌های میانبر
function QuickButton({ icon, text }: { icon: string; text: string }) {
  return (
    <button className="flex items-center gap-2 bg-[#0a1410] border border-[#1a2e24] hover:border-[#39FF88] text-gray-300 hover:text-white px-4 py-3 rounded-xl text-xs md:text-sm transition-all duration-300 backdrop-blur-sm">
      <span>{icon}</span>
      <span>{text}</span>
    </button>
  );
}
