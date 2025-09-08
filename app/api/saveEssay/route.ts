import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

const filePath = path.join(process.cwd(), "essays.json")

export async function POST(req: Request) {
  try {
    const { studentId, essay } = await req.json()

    // Load existing essays or start fresh
    let essays: any[] = []
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, "utf-8")
      essays = JSON.parse(fileData)
    }

    // Add new essay
    const newEssay = {
      id: essays.length + 1,
      studentId,
      essay,
      submittedAt: new Date().toISOString(),
    }
    essays.push(newEssay)

    // Save back to file
    fs.writeFileSync(filePath, JSON.stringify(essays, null, 2))

    return NextResponse.json({ success: true, essay: newEssay })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ success: false, error: "Failed to save essay" }, { status: 500 })
  }
}
