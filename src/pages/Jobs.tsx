import { useState, useMemo, useEffect } from "react";
import { Search, MapPin, Clock, Briefcase, Plus, Pencil, Trash2, X } from "lucide-react";

// --- ADMIN CHECK ---
// Only you can edit. Normal users will NOT see Edit/Delete.
// To become Admin: Open browser console (F12) and run:
// localStorage.setItem("echat_admin", "true") then refresh
const isAdmin = () => localStorage.getItem("echat_admin") === "true";

type Job = {
  id: number;
  title: string;
  company: string;
  location: string;
  salary: string;
  type: string;
  posted: string;
  description: string;
  applicants: number;
  logoColor: string;
  logoLetter: string;
};

const initialJobs: Job[] = [
  { id: 1, title: "Delivery Driver", company: "Swift Logistics SL", location: "Freetown", salary: "Le 2,500,000 / month", type: "Full-time", posted: "2h ago", description: "Deliver packages across Freetown. Must have valid bike license.", applicants: 12, logoColor: "bg-blue-500", logoLetter: "S" },
  { id: 2, title: "Primary School Teacher", company: "Bright Future Academy", location: "Bo", salary: "Le 3,000,000 / month", type: "Full-time", posted: "5h ago", description: "Teach English and Maths to primary pupils.", applicants: 8, logoColor: "bg-green-500", logoLetter: "B" },
  { id: 3, title: "Graphic Designer", company: "Krio Designs", location: "Remote", salary: "Le 4,500,000 / month", type: "Remote", posted: "1d ago", description: "Design flyers, logos and social media posts.", applicants: 21, logoColor: "bg-purple-500", logoLetter: "K" },
  { id: 4, title: "Sales Agent", company: "Africell SL", location: "Freetown", salary: "Le 2,000,000 + Commission", type: "Part-time", posted: "1d ago", description: "Sell SIMs and data bundles in shops and markets.", applicants: 15, logoColor: "bg-orange-500", logoLetter: "A" },
  { id: 5, title: "Nurse", company: "Connaught Hospital", location: "Freetown", salary: "Le 5,000,000 / month", type: "Full-time", posted: "2d ago", description: "Provide patient care in general ward.", applicants: 30, logoColor: "bg-red-500", logoLetter: "C" },
  { id: 6, title: "Cleaner", company: "Sparkle Homes", location: "Kenema", salary: "Le 1,800,000 / month", type: "Part-time", posted: "3d ago", description: "Clean offices and homes in Kenema.", applicants: 5, logoColor: "bg-teal-500", logoLetter: "S" },
];

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>(() => {
  const saved = localStorage.getItem("echat_jobs");
  return saved ? JSON.parse(saved) : initialJobs;
});
useEffect(() => {
  localStorage.setItem("echat_jobs", JSON.stringify(jobs));
}, [jobs]);
  const [locationFilter, setLocationFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState<number[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [adminMode] = useState(isAdmin());

  const [form, setForm] = useState({ title: "", company: "", location: "Freetown", salary: "", type: "Full-time", description: "" });

  const filtered = useMemo(() => jobs.filter(j => {
    const matchSearch = (j.title + j.company).toLowerCase().includes(search.toLowerCase());
    const matchLoc = locationFilter === "All" || j.location === locationFilter;
    const matchType = typeFilter === "All" || j.type === typeFilter;
    return matchSearch && matchLoc && matchType;
  }), [jobs, search, locationFilter, typeFilter]);

  const handleDelete = (id: number) => {
    if (confirm("Delete this job?")) setJobs(jobs.filter(j => j.id !== id));
  };

  const handleEdit = (job: Job) => {
    setEditingJob(job);
    setForm({ title: job.title, company: job.company, location: job.location, salary: job.salary, type: job.type, description: job.description });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.title || !form.company) return alert("Title and Company required");
    if (editingJob) {
      setJobs(jobs.map(j => j.id === editingJob.id ? { ...j, ...form } : j));
    } else {
      const newJob: Job = { id: Date.now(), title: form.title, company: form.company, location: form.location, salary: form.salary || "Negotiable", type: form.type, posted: "Just now", description: form.description, applicants: 0, logoColor: "bg-blue-600", logoLetter: form.company.charAt(0) };
      setJobs([newJob, ...jobs]);
    }
    setShowForm(false); setEditingJob(null); setForm({ title: "", company: "", location: "Freetown", salary: "", type: "Full-time", description: "" });
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Briefcase /> Jobs in Sierra Leone</h1>
        {adminMode && (
          <button onClick={() => { setEditingJob(null); setForm({ title: "", company: "", location: "Freetown", salary: "", type: "Full-time", description: "" }); setShowForm(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-full flex items-center gap-1"><Plus size={16} /> Post a Job</button>
        )}
      </div>

      {adminMode && <div className="bg-yellow-100 border border-yellow-300 text-yellow-800 px-3 py-2 rounded-lg mb-4 text-sm">🔑 Admin Mode ON - You can Edit / Delete jobs. Normal users don't see this.</div>}

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center bg-white rounded-full px-3 py-2 shadow flex-1 min-w-[200px]"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..." className="outline-none ml-2 w-full" /></div>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="bg-white rounded-full px-3 py-2 shadow"><option>All</option><option>Freetown</option><option>Bo</option><option>Kenema</option><option>Makeni</option><option>Remote</option></select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-white rounded-full px-3 py-2 shadow"><option>All</option><option>Full-time</option><option>Part-time</option><option>Remote</option><option>Internship</option></select>
      </div>

      <div className="grid gap-3">
        {filtered.map(job => (
          <div key={job.id} className="bg-white rounded-2xl p-4 shadow flex gap-3">
            <div className={`w-12 h-12 rounded-xl ${job.logoColor} text-white flex items-center justify-center font-bold text-xl shrink-0`}>{job.logoLetter}</div>
            <div className="flex-1">
              <h3 className="font-bold text-lg">{job.title}</h3>
              <p className="text-gray-600 text-sm">{job.company} • {job.applicants} applicants</p>
              <p className="text-gray-500 text-sm flex flex-wrap gap-2 mt-1"><span className="flex items-center gap-1"><MapPin size={14} />{job.location}</span><span className="flex items-center gap-1"><Clock size={14} />{job.posted}</span><span className="bg-blue-100 text-blue-700 px-2 rounded-full text-xs py-0.5">{job.type}</span></p>
              <p className="text-sm mt-2">{job.description}</p>
              <p className="font-bold text-green-600 mt-1">{job.salary}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setApplied(applied.includes(job.id) ? applied.filter(id => id !== job.id) : [...applied, job.id])} className={`px-4 py-1.5 rounded-full text-sm ${applied.includes(job.id) ? "bg-green-100 text-green-700" : "bg-blue-600 text-white"}`}>{applied.includes(job.id) ? "✓ Applied" : "Apply Now"}</button>
                {adminMode && (
                  <>
                    <button onClick={() => handleEdit(job)} className="px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-800 text-sm flex items-center gap-1"><Pencil size={14} /> Edit</button>
                    <button onClick={() => handleDelete(job.id)} className="px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-sm flex items-center gap-1"><Trash2 size={14} /> Delete</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md">
            <div className="flex justify-between"><h2 className="font-bold text-lg">{editingJob ? "Edit Job" : "Post a Job"}</h2><button onClick={() => setShowForm(false)}><X /></button></div>
            <input placeholder="Job Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full border rounded-lg px-3 py-2 mt-3" />
            <input placeholder="Company" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className="w-full border rounded-lg px-3 py-2 mt-2" />
            <input placeholder="Salary e.g. Le 3,000,000" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} className="w-full border rounded-lg px-3 py-2 mt-2" />
            <div className="flex gap-2 mt-2"><select value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="border rounded-lg px-3 py-2 flex-1"><option>Freetown</option><option>Bo</option><option>Kenema</option><option>Makeni</option><option>Remote</option></select><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="border rounded-lg px-3 py-2 flex-1"><option>Full-time</option><option>Part-time</option><option>Remote</option><option>Internship</option></select></div>
            <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border rounded-lg px-3 py-2 mt-2" rows={3} />
            <button onClick={handleSave} className="w-full bg-blue-600 text-white py-2 rounded-full mt-3">{editingJob ? "Save Changes" : "Post Job"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
export { Jobs };