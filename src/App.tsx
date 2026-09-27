export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="w-24 h-24 rounded-full md-glass md-neon-surface flex items-center justify-center">
        <span className="text-4xl">💎</span>
      </div>
      <div>
        <h1 className="text-3xl font-bold">
          Hello, I'm <span className="text-primary">Mass Diamond</span>
        </h1>
        <p className="text-text-subtle mt-2">
          Your Intelligent Assistant for a Bigger Tomorrow
        </p>
      </div>
      <div className="w-full max-w-xl md-glass rounded-full px-4 py-3 flex items-center gap-3">
        <input
          type="text"
          placeholder="چطور می‌تونم کمکت کنم؟"
          className="flex-1 bg-transparent outline-none text-text placeholder:text-text-subtle"
          dir="rtl"
        />
        <button className="w-10 h-10 rounded-full bg-primary text-background flex items-center justify-center">
          ➤
        </button>
      </div>
    </div>
  );
}
