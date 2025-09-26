"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { EssayStorage, type SavedEssay } from "@/lib/storage"
import { FileText, Search, Trash2, Calendar } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface EssayListModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectEssay: (essay: SavedEssay) => void
}

export function EssayListModal({ isOpen, onClose, onSelectEssay }: EssayListModalProps) {
  const [essays, setEssays] = useState<SavedEssay[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [filteredEssays, setFilteredEssays] = useState<SavedEssay[]>([])

  useEffect(() => {
    if (isOpen) {
      const savedEssays = EssayStorage.getAllEssays()
      setEssays(savedEssays)
      setFilteredEssays(savedEssays)
    }
  }, [isOpen])

  useEffect(() => {
    const filtered = essays.filter(
      (essay) =>
        essay.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        essay.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        essay.prompt.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    setFilteredEssays(filtered)
  }, [searchTerm, essays])

  const handleDeleteEssay = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm("Are you sure you want to delete this essay?")) {
      EssayStorage.deleteEssay(id)
      const updatedEssays = essays.filter((essay) => essay.id !== id)
      setEssays(updatedEssays)
    }
  }

  const getWordCount = (content: string) => {
    return content.trim().split(/\s+/).filter(Boolean).length
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Saved Essays ({essays.length})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search essays..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <ScrollArea className="h-[400px]">
            {filteredEssays.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {essays.length === 0 ? "No saved essays yet" : "No essays match your search"}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEssays.map((essay) => (
                  <div
                    key={essay.id}
                    className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      onSelectEssay(essay)
                      onClose()
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{essay.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {essay.content.substring(0, 150)}...
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <Badge variant="secondary" className="text-xs">
                            {getWordCount(essay.content)} words
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDistanceToNow(new Date(essay.updatedAt), { addSuffix: true })}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDeleteEssay(essay.id, e)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
