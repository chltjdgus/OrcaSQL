import React from 'react'

export default function InlineEmptyState({ icon, message }: { icon?: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-[#718096]">
      {icon}
      <span className="text-xs">{message}</span>
    </div>
  )
}
