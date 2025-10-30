
import React, { useState, useEffect } from 'react';
import { ReceiptData, BillSplit, ChatMessage } from './types';
import ReceiptPanel from './components/ReceiptPanel';
import ChatPanel from './components/ChatPanel';
import { LogoIcon, ReceiptIcon, ChatIcon } from './components/icons';

const App: React.FC = () => {
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [billSplit, setBillSplit] = useState<BillSplit>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'receipt' | 'chat'>('receipt');

  useEffect(() => {
    // When a receipt is successfully processed, switch to the chat view on mobile.
    if (receiptData && !isLoading) {
      setActiveView('chat');
    }
    // When starting a new tab, reset to receipt view.
    if (!receiptData) {
      setActiveView('receipt');
    }
  }, [receiptData, isLoading]);

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
    <div className="bg-slate-100 dark:bg-slate-900 h-screen font-sans text-slate-800 dark:text-slate-200 flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm flex-shrink-0">
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
        <div className={`${activeView === 'receipt' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-1/3`}>
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
        </div>
        <div className={`${activeView === 'chat' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-2/3`}>
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
        </div>
      </main>
      {receiptData && (
        <footer className="md:hidden flex items-center justify-around p-1 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-inner flex-shrink-0">
            <button
                onClick={() => setActiveView('receipt')}
                className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors w-24 h-16 ${activeView === 'receipt' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                aria-label="Receipt View"
            >
                <ReceiptIcon className="h-6 w-6 mb-1" />
                <span className="text-xs font-semibold">Receipt</span>
            </button>
            <button
                onClick={() => setActiveView('chat')}
                className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors w-24 h-16 ${activeView === 'chat' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                aria-label="Chat View"
            >
                <ChatIcon className="h-6 w-6 mb-1" />
                <span className="text-xs font-semibold">Chat</span>
            </button>
        </footer>
      )}
    </div>
  );
};

export default App;
