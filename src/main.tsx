import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const savedTheme = localStorage.getItem('llmc_theme');
const initialDark = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = initialDark ? 'dark' : 'light';
document.documentElement.style.colorScheme = initialDark ? 'dark' : 'light';

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
