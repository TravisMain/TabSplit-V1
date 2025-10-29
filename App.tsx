
import React, { useState } from 'react';
import { ReceiptData, BillSplit, ChatMessage } from './types';
import ReceiptPanel from './components/ReceiptPanel';
import ChatPanel from './components/ChatPanel';
import { LogoIcon } from './components/icons';

const App: React.FC = () => {
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [billSplit, setBillSplit] = useState<BillSplit>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setReceiptData(null);
    setBillSplit([]);
    setChatMessages([]);
    setIsLoading(false);
    setError(null);
  };

  const handleStartNewTab = () => {
    if (window.confirm('Are you sure you want to start a new tab? Any unsaved changes will be lost.')) {
      resetState();
    }
  };

  return (
    <div className="bg-slate-100 dark:bg-slate-900 min-h-screen font-sans text-slate-800 dark:text-slate-200 flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        <div className="flex items-center space-x-4">
          <LogoIcon />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            TabSplit
          </h1>
        </div>
        {receiptData && (
           <button
             onClick={handleStartNewTab}
             className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
           >
             Start New Tab
           </button>
        )}
      </header>
      <main className="flex-grow flex flex-col md:flex-row overflow-hidden">
        <ReceiptPanel
          receiptData={receiptData}
          setReceiptData={setReceiptData}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          error={error}
          setError={setError}
          resetState={resetState}
          billSplit={billSplit}
          setBillSplit={setBillSplit}
          setChatMessages={setChatMessages}
        />
        <ChatPanel
          receiptData={receiptData}
          billSplit={billSplit}
          setBillSplit={setBillSplit}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          error={error}
          setError={setError}
        />
      </main>
    </div>
  );
};

export default App;