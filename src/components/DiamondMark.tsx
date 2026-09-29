<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mass Diamond AI</title>
    <style>
        /* تنظیمات کلی */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        body {
            background-color: #050a08; /* پس زمینه بسیار تیره */
            color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden; /* جلوگیری از اسکرول اضافه */
            position: relative;
        }

        /* افکت ستاره‌های پس زمینه */
        body::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image: radial-gradient(circle, rgba(0, 255, 136, 0.1) 1px, transparent 1px);
            background-size: 50px 50px;
            z-index: -1;
        }

        /* کانتینر اصلی موبایل */
        .app-container {
            width: 100%;
            max-width: 400px;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 40px 20px 20px 20px;
            position: relative;
        }

        /* بخش بالایی: لوگو و متن */
        .hero-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            margin-top: 10vh;
        }

        /* شبیه‌سازی الماس با CSS */
        .diamond-container {
            position: relative;
            width: 150px;
            height: 150px;
            margin-bottom: 40px;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .diamond {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #00ff88, #00b36b);
            transform: rotate(45deg);
            border-radius: 10px;
            box-shadow: 0 0 30px rgba(0, 255, 136, 0.6), inset 0 0 20px rgba(255, 255, 255, 0.5);
            animation: float 3s ease-in-out infinite;
        }

        /* حلقه دور الماس */
        .diamond-ring {
            position: absolute;
            width: 140px;
            height: 40px;
            border: 2px solid rgba(0, 255, 136, 0.4);
            border-radius: 50%;
            transform: rotate(-15deg);
            box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
            animation: orbit 4s linear infinite;
        }

        /* انیمیشن‌ها */
        @keyframes float {
            0%, 100% { transform: rotate(45deg) translateY(0); }
            50% { transform: rotate(45deg) translateY(-10px); }
        }

        @keyframes orbit {
            0% { transform: rotate(-15deg) scale(1); opacity: 0.5; }
            50% { transform: rotate(-15deg) scale(1.05); opacity: 1; }
            100% { transform: rotate(-15deg) scale(1); opacity: 0.5; }
        }

        /* متن‌ها */
        .title {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            letter-spacing: 1px;
        }

        .title span {
            color: #00ff88;
            text-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
        }

        .subtitle {
            font-size: 12px;
            color: #889990;
            max-width: 250px;
            line-height: 1.5;
        }

        /* بخش پایینی: دکمه‌ها */
        .bottom-section {
            display: flex;
            flex-direction: column;
            gap: 15px;
            padding-bottom: 20px;
        }

        /* ردیف دکمه‌ها */
        .button-row {
            display: flex;
            gap: 10px;
            justify-content: center;
        }

        /* دکمه‌های شیشه‌ای */
        .glass-btn {
            background: rgba(0, 255, 136, 0.05);
            border: 1px solid rgba(0, 255, 136, 0.2);
            border-radius: 25px;
            padding: 12px 20px;
            color: #a0b0a8;
            font-size: 13px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex: 1;
            cursor: pointer;
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
        }

        .glass-btn:hover {
            background: rgba(0, 255, 136, 0.15);
            border-color: rgba(0, 255, 136, 0.5);
            color: #ffffff;
            box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
        }

        /* دکمه وسط (مداد) */
        .center-btn {
            position: absolute;
            bottom: 90px;
            left: 50%;
            transform: translateX(-50%);
            width: 60px;
            height: 60px;
            background: #e0eaff;
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            box-shadow: 0 0 20px rgba(224, 234, 255, 0.4);
            cursor: pointer;
            z-index: 10;
            border: none;
        }

        .center-btn svg {
            width: 24px;
            height: 24px;
            fill: #1a2b3c;
        }

        /* آیکون‌های SVG ساده */
        .icon {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }
    </style>
</head>
<body>

    <div class="app-container">
        
        <!-- بخش اصلی (لوگو و متن) -->
        <div class="hero-section">
            <div class="diamond-container">
                <div class="diamond-ring"></div>
                <div class="diamond"></div>
            </div>
            
            <h1 class="title">Hello, I'm <span>Mass Diamond</span></h1>
            <p class="subtitle">Your Intelligent Assistant for a Bigger Tomorrow</p>
        </div>

        <!-- دکمه وسط (مداد) -->
        <button class="center-btn">
            <svg viewBox="0 0 24 24">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
        </button>

        <!-- بخش پایینی (دکمه‌ها) -->
        <div class="bottom-section">
            <div class="button-row">
                <button class="glass-btn">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    Search
                </button>
                <button class="glass-btn">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                    Images
                </button>
            </div>
            
            <div class="button-row">
                <button class="glass-btn">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm6 16H6V8h2v2c0 1.1.9 2 2 2s2-.9 2-2V8h4v2c0 1.1.9 2 2 2s2-.9 2-2V8h2v12z"/></svg>
                    Products
                </button>
                <button class="glass-btn">
                    <svg class="icon" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
                    Home
                </button>
            </div>
        </div>
    </div>

</body>
</html>
