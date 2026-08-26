// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useCallback, useRef } from 'react';

interface Props {
  files: File[];
  onFilesChange: (files: File[]) => void;
}

export function ImageUpload({ files, onFilesChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const dropped = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      onFilesChange([...files, ...dropped]);
    },
    [files, onFilesChange]
  );

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      onFilesChange([...files, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleSelect}
          className="hidden"
        />
        <p className="text-gray-600">
          Drop images here or click to select
        </p>
        <p className="text-sm text-gray-400 mt-1">
          JPEG, PNG, WebP, GIF — multiple files supported
        </p>
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="relative group border rounded-md overflow-hidden"
            >
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="w-20 h-20 object-cover"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                X
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 truncate">
                {file.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <p className="text-sm text-gray-500">
          {files.length} image{files.length !== 1 ? 's' : ''} selected
          ({(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB total)
        </p>
      )}
    </div>
  );
}
