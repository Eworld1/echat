// SetupDetails.tsx - PART 1 TAB 1 SETUP - CORRECTED for Echat
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../services/firebase";

export default function SetupDetails({ liveId, roomName }: { liveId: string; roomName: string }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Just Chatting");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("Public");
  const [location, setLocation] = useState("Freetown");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [remindMe, setRemindMe] = useState(true);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [saving, setSaving] = useState(false);

  const handleThumbnail = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbnailFile(file);
    setThumbnailPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!title.trim()) { alert("Please enter Live Title - it is required"); return; }
    setSaving(true);
    try {
      let imageUrl = "";
      if (thumbnailFile) {
        const thumbRef = ref(storage, `thumbnails/${liveId}-${Date.now()}.jpg`);
        await uploadBytes(thumbRef, thumbnailFile);
        imageUrl = await getDownloadURL(thumbRef);
      }
      await setDoc(doc(db, "lives", liveId), {
        liveId, roomName,
        title: title.trim(),
        category, description,
        privacy, location,
        thumbnailUrl: imageUrl,
        isScheduled,
        scheduledAt: isScheduled ? `${scheduleDate}T${scheduleTime}` : null,
        remindMe: isScheduled ? remindMe : false,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      alert("Setup saved! RTMP + Stream Key still same.");
    } catch (err: any) {
      alert("Error saving: " + err.message);
    }
    setSaving(false);
  };

  return (
    <div style={{ padding: 16 }}>
      <h3>Live Setup</h3>
      <label>Live Title * (required)</label>
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sunday Service Live from Freetown" style={{width:"100%", padding:10, margin:"6px 0 12px"}} />
      <label>Category</label>
      <select value={category} onChange={e=>setCategory(e.target.value)} style={{width:"100%", padding:10, margin:"6px 0 12px"}}>
        <option>Just Chatting</option><option>Music</option><option>Gaming</option><option>News</option><option>Sports</option><option>Church</option><option>Education</option><option>Market / Selling</option>
      </select>
      <label>Description</label>
      <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Tell viewers what this live is about..." rows={3} style={{width:"100%", padding:10, margin:"6px 0 12px"}} />
      <label>Thumbnail</label>
      <input type="file" accept="image/*" onChange={handleThumbnail} style={{margin:"6px 0 12px", display:"block"}} />
      {thumbnailPreview && <img src={thumbnailPreview} alt="Thumbnail preview" style={{width:"100%", borderRadius:8, marginBottom:12}} />}
      <label>Privacy</label>
      <select value={privacy} onChange={e=>setPrivacy(e.target.value)} style={{width:"100%", padding:10, margin:"6px 0 12px"}}>
        <option>Public</option><option>Followers Only</option><option>Private</option>
      </select>
      <label><input type="checkbox" checked={isScheduled} onChange={e=>setIsScheduled(e.target.checked)} /> Schedule Live</label>
      {isScheduled && (<div style={{margin:"10px 0"}}>
        <input type="date" value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)} style={{padding:10, marginRight:8}} />
        <input type="time" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} style={{padding:10}} />
        <label style={{display:"block", marginTop:8}}><input type="checkbox" checked={remindMe} onChange={e=>setRemindMe(e.target.checked)} /> Remind Me</label>
        {scheduleDate && scheduleTime && <p>📅 Feed will show countdown to: {scheduleDate} at {scheduleTime}</p>}
      </div>)}
      <label>Location</label>
      <select value={location} onChange={e=>setLocation(e.target.value)} style={{width:"100%", padding:10, margin:"6px 0 12px"}}>
        <option>Freetown</option><option>Bo</option><option>Kenema</option><option>Makeni</option><option>Kono</option><option>Other</option>
      </select>
      <button onClick={handleSave} disabled={saving} style={{width:"100%", padding:12, background:"#000", color:"#fff", borderRadius:8}}>
        {saving ? "Saving..." : "Save Setup"}
      </button>
      <p style={{fontSize:12, color:"#666"}}>Your RTMP URL + Stream Key below stay unchanged.</p>
    </div>
  );
}