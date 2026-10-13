import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
} from 'react';

const ProjectRefreshContext = createContext(null);

export function ProjectRefreshProvider({ children }) {
    const [refreshMap, setRefreshMap] = useState({});

    const notifyProjectChanged = useCallback((projectId) => {
        if (!projectId) return;

        setRefreshMap((prev) => ({
            ...prev,
            [projectId]:
                (prev[projectId] || 0) + 1,
        }));
    }, []);

    const value = useMemo(
        () => ({
            refreshMap,
            notifyProjectChanged,
        }),
        [refreshMap, notifyProjectChanged]
    );

    return (
        <ProjectRefreshContext.Provider value={value}>
            {children}
        </ProjectRefreshContext.Provider>
    );
}

export function useProjectRefresh(projectId) {
    const context = useContext(ProjectRefreshContext);

    if (!context) {
        throw new Error(
            'useProjectRefresh must be used inside ProjectRefreshProvider'
        );
    }

    return {
        refreshKey: projectId ? context.refreshMap[projectId] || 0 : 0,
        notifyProjectChanged: context.notifyProjectChanged,
    };
}