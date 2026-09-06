import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, X, Edit3 } from 'lucide-react';

export default function UploadZone({
  label = 'Upload Document or Image',
  sublabel = 'PDF, DOCX, TXT, PNG, or JPG up to 30MB',
  file,
  setFile,
  text,
  setText,
  id = 'upload-dropzone',
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isTextMode, setIsTextMode] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);

  const updateSelectedFile = (selected) => {
    setFile(selected);
    setText('');
    setIsTextMode(false);
    if (selected && (selected.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(selected.name))) {
      setImagePreview(URL.createObjectURL(selected));
    } else {
      setImagePreview(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      updateSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      updateSelectedFile(e.target.files[0]);
    }
  };

  const handleClear = () => {
    setFile(null);
    setImagePreview(null);
    setText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-semibold text-slate-800">{label}</label>
        <button
          type="button"
          onClick={() => {
            setIsTextMode(!isTextMode);
            if (!isTextMode) {
              setFile(null);
              setImagePreview(null);
            }
          }}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
        >
          <Edit3 className="h-3 w-3" />
          {isTextMode ? 'Switch to file upload' : 'Paste text instead'}
        </button>
      </div>

      {isTextMode ? (
        <div className="relative">
          <textarea
            id={`${id}-textarea`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your contract, policy, NDA, or clause text here..."
            rows={8}
            className="w-full rounded-xl border border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 font-mono"
          />
          {text && (
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>{text.split(/\s+/).filter(Boolean).length} words</span>
              <button
                type="button"
                onClick={() => setText('')}
                className="text-rose-600 hover:underline"
              >
                Clear text
              </button>
            </div>
          )}
        </div>
      ) : file ? (
        /* Selected file pill card */
        <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 transition">
          <div className="flex items-center gap-3 overflow-hidden">
            {imagePreview ? (
              <img
                src={imagePreview}
                alt="Uploaded Preview"
                className="h-12 w-12 shrink-0 rounded-lg object-cover border border-indigo-200"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <FileText className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{file.name}</p>
              <p className="text-xs text-slate-500">
                {(file.size / 1024).toFixed(1)} KB • {imagePreview ? 'Image (OCR enabled)' : file.type || 'Document'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : (
        /* Dropzone */
        <div
          id={id}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/60 scale-[0.99]'
              : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 group-hover:scale-110 transition">
            <UploadCloud className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-800">
            <span className="font-semibold text-indigo-600">Click to upload</span> or drag and drop
          </p>
          <p className="mt-1 text-xs text-slate-500">{sublabel}</p>
        </div>
      )}
    </div>
  );
}
