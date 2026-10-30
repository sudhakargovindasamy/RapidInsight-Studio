import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PlaygroundCanvas from "../components/playground/PlaygroundCanvas";
import PlaygroundActionsBar from "../components/playground/PlaygroundActionsBar";
import { usePlaygroundSchemas } from "../hooks/usePlaygroundSchemas";
import "./SchemaPlaygroundPage.css";

export default function SchemaPlaygroundPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [layoutMode, setLayoutMode] = useState("star"); // 'default' | 'star'

  const {
    entities,
    dataModel,
    loading,
    error,
    searchTerm,
    setSearchTerm,
    refresh,
    generateForEntity,
    generatingBySchemaId,
  } = usePlaygroundSchemas(projectId);

  const handleViewTable = (entity) => {
    const generatedTableId =
      entity.generatedTableId ||
      entity.generated_table_id;

    if (!projectId || !generatedTableId) {
      return;
    }

    navigate(
      `/projects/${projectId}/tables/${generatedTableId}`,
      { state: { from: `/projects/${projectId}/playground` } }
    );
  };

  return (
    <main className="schema-playground-page">

      {error ? <div className="playground-error">{error}</div> : null}

      <PlaygroundCanvas
        projectId={projectId}
        entities={entities}
        dataModel={dataModel}
        layoutMode={layoutMode}
        onToggleLayout={() => setLayoutMode(prev => prev === 'default' ? 'star' : 'default')}
        loading={loading}
        generatingBySchemaId={generatingBySchemaId}
        onGenerate={generateForEntity}
        onViewTable={handleViewTable}
        onRefresh={refresh}
      />
    </main>
  );
}
