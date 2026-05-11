# SendPulse – ניקוי אנשי קשר לא פעילים

כלי פנימי למחיקת אנשי קשר ישנים מ-WhatsApp Bots ב-SendPulse.

## דרישות מקדימות

- Node.js 18+
- חשבון SendPulse עם API credentials (Client ID + Client Secret)

## התקנה והרצה

### Backend

```bash
cd backend
npm install
cp .env.example .env   # ערוך אם נדרש (PORT ברירת מחדל: 3001)
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

הפרונטאנד יהיה זמין בכתובת: http://localhost:5173

## שימוש

1. הזן את ה-**Client ID** וה-**Client Secret** מממשק SendPulse (Settings → API).
2. לחץ **"טען בוטים"** – תיפתח רשימת הבוטים שלך.
3. בחר **בוט** מהרשימה.
4. הגדר את **קריטריון אי-הפעילות**:
   - לפי **מספר ימים** (ברירת מחדל 30)
   - לפי **תאריך ספציפי** – ימחקו אנשי קשר שלא היו פעילים מאז התאריך הנבחר
5. לחץ **"סריקה (Preview)"** – תוצאות יוצגו בלוג ללא מחיקה בפועל.
6. לחץ **"מחיקה סופית (Live Delete)"** – יש לאשר את הפעולה. המחיקה מתבצעת עם עיכוב של 300ms בין רשומה לרשומה כדי למנוע Rate Limiting.

## מבנה הפרויקט

```
├── backend/
│   ├── server.js          # Express server + SendPulse API integration
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # ממשק ראשי (RTL + Tailwind)
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
├── .gitignore
└── README.md
```

## הערות אבטחה

- ה-Client Secret **לא** נשמר בשום צד – הוא עובר ישירות ל-API בכל בקשה.
- לעולם אל תעלה קובץ `.env` ל-GitHub.
