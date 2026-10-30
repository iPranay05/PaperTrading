import { NextResponse } from "next/server";
import { ensureInitialData } from "@/lib/seed";

export async function GET() {
  try {
    await ensureInitialData();
    return NextResponse.json({ success: true, message: "System initialized and seeded." });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
