function ProjectSidebar({ activeTab, onChangeTab }) {
  return (
    <aside className="project-sidebar">
      <button
        type="button"
        className={activeTab === 'upload' ? 'project-tab active' : 'project-tab'}
        onClick={() => onChangeTab('upload')}
      >
        Upload Schema
      </button>
 
      <button
        type="button"
        className={activeTab === 'schemas' ? 'project-tab active' : 'project-tab'}
        onClick={() => onChangeTab('schemas')}
      >
        My Schemas
      </button>
    </aside>
  );
}
 
export default ProjectSidebar;
