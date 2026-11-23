import { useState, useMemo, useEffect } from "react";
import { Search, MapPin, Clock, Briefcase, Plus, Pencil, Trash2, X, ArrowLeft, Phone, Banknote, Building2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { JobItem, JobType } from "../types";
import { ListingImage, ListingPhotoPicker, canManageListing, timeAgo, ContactLink, type PhotoSelection } from "../components/ListingPhoto";

const JOB_TYPES: JobType[] = ["Full-time", "Part-time", "Remote", "Contract"];
const COMMON_LOCATIONS = ["Freetown", "Bo", "Kenema", "Makeni", "Koidu", "Remote"];

type JobForm = { title: string; company: string; location: string; type: JobType; salary: string; description: string; contactInfo: string };
const emptyForm: JobForm = { title: "", company: "", location: "Freetown", type: "Full-time", salary: "", description: "", contactInfo: "" };
const noPhoto: PhotoSelection = { file: null, removed: false };

export default function Jobs() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [locationFilter, setLocationFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobItem | null>(null);
  const [form, setForm] = useState<JobForm>(emptyForm);
  const [photo, setPhoto] = useState<PhotoSelection>(noPhoto);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadJobs = async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      setJobs(await api.getJobs());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load jobs.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadJobs(); }, []);

  const locations = useMemo(() => {
    const all = new Set(COMMON_LOCATIONS);
    jobs.forEach(j => j.location && all.add(j.location));
    return Array.from(all);
  }, [jobs]);

  const filtered = useMemo(() => jobs.filter(j => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || `${j.title} ${j.company} ${j.description} ${j.location}`.toLowerCase().includes(q);
    const matchLoc = locationFilter === "All" || j.location === locationFilter;
    const matchType = typeFilter === "All" || j.type === typeFilter;
    return matchSearch && matchLoc && matchType;
  }), [jobs, search, locationFilter, typeFilter]);

  const openCreate = () => {
    setEditingJob(null);
    setForm(emptyForm);
    setPhoto(noPhoto);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (job: JobItem) => {
    setEditingJob(job);
    setForm({ title: job.title, company: job.company, location: job.location, type: job.type, salary: job.salary, description: job.description, contactInfo: job.contactInfo });
    setPhoto(noPhoto);
    setFormError("");
    setShowForm(true);
  };

  const handleDelete = async (job: JobItem) => {
    if (!confirm(`Delete "${job.title}"?`)) return;
    try {
      await api.deleteJob(job.id);
      setJobs(prev => prev.filter(j => j.id !== job.id));
      if (selectedJobId === job.id) setSelectedJobId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete job.");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.company.trim()) { setFormError("Job title and company are required."); return; }
    setIsSaving(true);
    setFormError("");
    try {
      const input = { fields: { ...form }, image: photo.file, removeImage: photo.removed };
      if (editingJob) {
        const updated = await api.updateJob(editingJob.id, input);
        setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
      } else {
        const created = await api.createJob(input);
        setJobs(prev => [created, ...prev]);
      }
      setShowForm(false);
      setEditingJob(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save job.");
    } finally {
      setIsSaving(false);
    }
  };

  const activeJob = jobs.find(j => j.id === selectedJobId);

  const ownerActions = (job: JobItem) => canManageListing(user, job.ownerId) && (
    <>
      <button onClick={(e) => { e.stopPropagation(); openEdit(job); }} className="px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-800 text-sm flex items-center gap-1"><Pencil size={14} /> Edit</button>
      <button onClick={(e) => { e.stopPropagation(); void handleDelete(job); }} className="px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-sm flex items-center gap-1"><Trash2 size={14} /> Delete</button>
    </>
  );

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {activeJob ? (
        // JOB DETAILS
        <div className="space-y-3">
          <button onClick={() => setSelectedJobId(null)} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full shadow text-sm font-semibold"><ArrowLeft size={16} /> Back to Jobs</button>
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            {activeJob.image && <ListingImage src={activeJob.image} name={activeJob.company} className="w-full h-56 sm:h-72" />}
            <div className="p-5">
              <div className="flex gap-3 items-start">
                {!activeJob.image && <ListingImage name={activeJob.company} className="w-16 h-16 rounded-xl" letterClassName="text-2xl" />}
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold break-words">{activeJob.title}</h1>
                  <p className="text-gray-600 flex items-center gap-1"><Building2 size={15} /> {activeJob.company}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3 text-sm text-gray-600">
                <span className="flex items-center gap-1"><MapPin size={14} />{activeJob.location}</span>
                <span className="flex items-center gap-1"><Clock size={14} />{timeAgo(activeJob.createdAt)}</span>
                <span className="bg-blue-100 text-blue-700 px-2 rounded-full text-xs py-0.5">{activeJob.type}</span>
              </div>
              <p className="font-bold text-green-600 mt-3 flex items-center gap-1"><Banknote size={16} /> {activeJob.salary}</p>

              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-5 mb-1">Job Description</h3>
              <p className="text-sm whitespace-pre-wrap break-words">{activeJob.description || "No description provided."}</p>

              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-5 mb-1">How to Apply / Contact</h3>
              <p className="text-sm flex items-start gap-2"><Phone size={15} className="mt-0.5 shrink-0" />{activeJob.contactInfo ? <ContactLink value={activeJob.contactInfo} /> : <span className="text-gray-500">No contact info provided.</span>}</p>

              <p className="text-xs text-gray-400 mt-5">Posted by {activeJob.ownerName || "Member"}</p>
              <div className="flex flex-wrap gap-2 mt-3">{ownerActions(activeJob)}</div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 justify-between items-center mb-4">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Briefcase /> Jobs in Sierra Leone</h1>
            {user && <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-full flex items-center gap-1"><Plus size={16} /> Post a Job</button>}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex items-center bg-white rounded-full px-3 py-2 shadow flex-1 min-w-[200px]"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..." className="outline-none ml-2 w-full bg-transparent" /></div>
            <select aria-label="Filter by location" value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="bg-white rounded-full px-3 py-2 shadow"><option value="All">All locations</option>{locations.map(l => <option key={l}>{l}</option>)}</select>
            <select aria-label="Filter by job type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-white rounded-full px-3 py-2 shadow"><option value="All">All types</option>{JOB_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-gray-400"><div className="w-8 h-8 rounded-full border-2 border-blue-600 border-t-transparent animate-spin mx-auto mb-2" /><p className="text-xs">Loading jobs...</p></div>
          ) : loadError ? (
            <div className="bg-white rounded-2xl p-6 text-center shadow"><p className="text-sm text-red-600">{loadError}</p><button onClick={() => void loadJobs()} className="mt-3 px-4 py-1.5 rounded-full bg-blue-600 text-white text-sm">Retry</button></div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center shadow">
              <Briefcase size={40} className="mx-auto text-gray-300 mb-3" />
              <h3 className="font-bold">No jobs found</h3>
              <p className="text-xs text-gray-500 mt-1">{jobs.length ? "Try a different search or filter." : "Be the first to post a job!"}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map(job => (
                <div key={job.id} onClick={() => setSelectedJobId(job.id)} className="bg-white rounded-2xl p-4 shadow flex gap-3 cursor-pointer hover:shadow-md transition">
                  <ListingImage src={job.image} name={job.company} className="w-14 h-14 rounded-xl" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg break-words">{job.title}</h3>
                    <p className="text-gray-600 text-sm truncate">{job.company}</p>
                    <p className="text-gray-500 text-sm flex flex-wrap gap-2 mt-1"><span className="flex items-center gap-1"><MapPin size={14} />{job.location}</span><span className="flex items-center gap-1"><Clock size={14} />{timeAgo(job.createdAt)}</span><span className="bg-blue-100 text-blue-700 px-2 rounded-full text-xs py-0.5">{job.type}</span></p>
                    {job.description && <p className="text-sm mt-2 line-clamp-2 break-words">{job.description}</p>}
                    <p className="font-bold text-green-600 mt-1">{job.salary}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedJobId(job.id); }} className="px-4 py-1.5 rounded-full text-sm bg-blue-600 text-white">View Details</button>
                      {ownerActions(job)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50">
          <form onSubmit={handleSave} className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-md max-h-[92vh] overflow-y-auto space-y-2">
            <div className="flex justify-between items-center"><h2 className="font-bold text-lg">{editingJob ? "Edit Job" : "Post a Job"}</h2><button type="button" aria-label="Close" onClick={() => setShowForm(false)}><X /></button></div>
            <input required placeholder="Job Title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
            <input required placeholder="Company *" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
            <div className="flex gap-2">
              <input list="job-locations" placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="border rounded-lg px-3 py-2 flex-1 min-w-0" />
              <datalist id="job-locations">{COMMON_LOCATIONS.map(l => <option key={l} value={l} />)}</datalist>
              <select aria-label="Job type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as JobType })} className="border rounded-lg px-3 py-2 flex-1 min-w-0">{JOB_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            </div>
            <input placeholder="Salary e.g. Le 3,000,000 / month" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
            <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border rounded-lg px-3 py-2" rows={3} />
            <input placeholder="Contact info (phone, email or how to apply)" value={form.contactInfo} onChange={e => setForm({ ...form, contactInfo: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
            <ListingPhotoPicker currentImage={editingJob?.image} value={photo} onChange={setPhoto} disabled={isSaving} />
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={isSaving} className="w-full bg-blue-600 text-white py-2 rounded-full mt-1 disabled:opacity-60">{isSaving ? "Saving..." : editingJob ? "Save Changes" : "Post Job"}</button>
          </form>
        </div>
      )}
    </div>
  );
}
export { Jobs };
