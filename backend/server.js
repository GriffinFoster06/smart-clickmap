// Enhanced clustering algorithm for server.js
// Replace the processClicksIntoClusters function with this:

function processClicksIntoClusters(points, threshold = 3) {
    if (points.length === 0) return [];

    console.log(`🧠 Smart clustering: ${points.length} points, threshold: ${threshold}%`);

    // Step 1: Density-based clustering with adaptive parameters
    const clusters = performDensityClustering(points);
    
    // Step 2: Calculate comprehensive metrics for each cluster
    const enrichedClusters = clusters.map(cluster => calculateClusterMetrics(cluster, points.length));
    
    // Step 3: Split oversized clusters
    const splitClusters = enrichedClusters.flatMap(cluster => 
        shouldSplitCluster(cluster) ? splitLargeCluster(cluster) : [cluster]
    );
    
    // Step 4: Filter by threshold and finalize
    const finalClusters = splitClusters
        .filter(c => c.percentage >= threshold)
        .sort((a, b) => b.percentage - a.percentage);

    // Mark top cluster
    if (finalClusters.length > 0) {
        finalClusters[0].isTop = true;
    }

    console.log(`✅ Generated ${finalClusters.length} intelligent clusters`);
    return finalClusters;
}

function performDensityClustering(points) {
    const clusters = [];
    const visited = new Set();
    const noise = new Set();
    
    // Adaptive parameters based on data density
    const totalDensity = points.length / (1.0 * 1.0); // points per unit area
    const minPts = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(points.length) / 4)));
    const baseEps = 0.08; // base distance in normalized coordinates
    const adaptiveEps = Math.max(0.03, Math.min(0.15, baseEps * Math.sqrt(50 / points.length)));
    
    console.log(`🔍 Clustering params: minPts=${minPts}, eps=${adaptiveEps.toFixed(3)}`);

    for (let i = 0; i < points.length; i++) {
        if (visited.has(i)) continue;
        
        visited.add(i);
        const neighbors = getNeighbors(points, i, adaptiveEps);
        
        if (neighbors.length < minPts) {
            noise.add(i);
        } else {
            const cluster = [];
            expandCluster(points, i, neighbors, cluster, visited, adaptiveEps, minPts);
            if (cluster.length > 0) {
                clusters.push(cluster);
            }
        }
    }

    // Handle noise points by creating micro-clusters or merging with nearby clusters
    handleNoisePoints(points, clusters, Array.from(noise), adaptiveEps);

    return clusters;
}

function getNeighbors(points, pointIndex, eps) {
    const neighbors = [];
    const point = points[pointIndex];
    
    for (let i = 0; i < points.length; i++) {
        if (i === pointIndex) continue;
        
        const distance = euclideanDistance(point, points[i]);
        if (distance <= eps) {
            neighbors.push(i);
        }
    }
    
    return neighbors;
}

function expandCluster(points, pointIndex, neighbors, cluster, visited, eps, minPts) {
    cluster.push(pointIndex);
    
    for (let i = 0; i < neighbors.length; i++) {
        const neighborIndex = neighbors[i];
        
        if (!visited.has(neighborIndex)) {
            visited.add(neighborIndex);
            const neighborNeighbors = getNeighbors(points, neighborIndex, eps);
            
            if (neighborNeighbors.length >= minPts) {
                neighbors.push(...neighborNeighbors);
            }
        }
        
        if (!cluster.includes(neighborIndex)) {
            cluster.push(neighborIndex);
        }
    }
}

function handleNoisePoints(points, clusters, noiseIndices, eps) {
    // Try to merge isolated points with nearby clusters or create micro-clusters
    for (const noiseIndex of noiseIndices) {
        let merged = false;
        const noisePoint = points[noiseIndex];
        
        // Try to merge with existing cluster
        for (const cluster of clusters) {
            const clusterCenter = calculateCentroid(cluster.map(idx => points[idx]));
            const distance = euclideanDistance(noisePoint, clusterCenter);
            
            if (distance <= eps * 1.5) { // Slightly more lenient for noise
                cluster.push(noiseIndex);
                merged = true;
                break;
            }
        }
        
        // Create micro-cluster if significant enough
        if (!merged && Math.random() > 0.7) { // Only keep some isolated points
            clusters.push([noiseIndex]);
        }
    }
}

function calculateClusterMetrics(clusterIndices, totalPoints) {
    const clusterPoints = clusterIndices.map(idx => points[idx]);
    const count = clusterPoints.length;
    const percentage = Math.round((count / totalPoints) * 100);
    
    // Calculate centroid
    const centroid = calculateCentroid(clusterPoints);
    
    // Calculate spread metrics
    const distances = clusterPoints.map(p => euclideanDistance(p, centroid));
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const spreadRadius = avgDistance;
    
    // Calculate density (points per unit area)
    const area = Math.PI * (maxDistance * maxDistance);
    const density = area > 0 ? count / area : count;
    
    // Calculate shape irregularity
    const irregularity = calculateShapeIrregularity(clusterPoints, centroid, avgDistance);
    
    // Calculate compactness
    const compactness = avgDistance / (maxDistance || 1);
    
    return {
        id: `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        x: centroid.x,
        y: centroid.y,
        count,
        percentage,
        radius: spreadRadius,
        maxRadius: maxDistance,
        density,
        compactness,
        irregularity,
        points: clusterPoints,
        isTop: false
    };
}

function calculateCentroid(points) {
    const sum = points.reduce(
        (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
        { x: 0, y: 0 }
    );
    return {
        x: sum.x / points.length,
        y: sum.y / points.length
    };
}

function calculateShapeIrregularity(points, centroid, avgRadius) {
    if (points.length < 3) return 0;
    
    // Calculate how much the shape deviates from a perfect circle
    const angles = points.map(p => Math.atan2(p.y - centroid.y, p.x - centroid.x));
    angles.sort((a, b) => a - b);
    
    // Check for clustering in angular distribution
    let maxGap = 0;
    for (let i = 0; i < angles.length; i++) {
        const nextAngle = angles[(i + 1) % angles.length];
        const gap = nextAngle > angles[i] 
            ? nextAngle - angles[i] 
            : (2 * Math.PI) - angles[i] + nextAngle;
        maxGap = Math.max(maxGap, gap);
    }
    
    // Irregularity is high if points are unevenly distributed around the circle
    const expectedGap = (2 * Math.PI) / points.length;
    const irregularity = Math.min(1, maxGap / (expectedGap * 2));
    
    return irregularity;
}

function shouldSplitCluster(cluster) {
    // Split if cluster is too large in area OR has too many points for its density
    const areaThreshold = 0.25; // 25% of total screen area
    const clusterArea = Math.PI * (cluster.maxRadius * cluster.maxRadius);
    const pointThreshold = Math.max(20, Math.sqrt(cluster.count) * 5);
    
    return (
        clusterArea > areaThreshold || 
        cluster.count > pointThreshold ||
        (cluster.maxRadius > 0.3 && cluster.compactness < 0.3) // Large and sparse
    );
}

function splitLargeCluster(cluster) {
    if (cluster.points.length < 4) return [cluster]; // Too small to split
    
    console.log(`🔄 Splitting large cluster: ${cluster.count} points, ${cluster.percentage}%`);
    
    // Use k-means clustering to split into 2-4 subclusters
    const k = Math.min(4, Math.max(2, Math.ceil(cluster.count / 8)));
    const subclusters = performKMeans(cluster.points, k);
    
    // Convert subclusters back to the same format
    return subclusters
        .filter(subcluster => subcluster.length >= 2) // Only keep substantial subclusters
        .map(subclusterIndices => {
            const subclusterPoints = subclusterIndices;
            const subCount = subclusterPoints.length;
            const subPercentage = Math.round((subCount / cluster.count) * cluster.percentage);
            
            const centroid = calculateCentroid(subclusterPoints);
            const distances = subclusterPoints.map(p => euclideanDistance(p, centroid));
            const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
            const maxDistance = Math.max(...distances);
            
            return {
                id: `split_${cluster.id}_${Math.random().toString(36).substr(2, 4)}`,
                x: centroid.x,
                y: centroid.y,
                count: subCount,
                percentage: subPercentage,
                radius: avgDistance,
                maxRadius: maxDistance,
                density: cluster.density * 1.5, // Subclusters are denser
                compactness: avgDistance / (maxDistance || 1),
                irregularity: calculateShapeIrregularity(subclusterPoints, centroid, avgDistance),
                points: subclusterPoints,
                isTop: false
            };
        });
}

function performKMeans(points, k) {
    if (points.length <= k) return points.map(p => [p]);
    
    // Initialize centroids randomly
    let centroids = [];
    for (let i = 0; i < k; i++) {
        centroids.push(points[Math.floor(Math.random() * points.length)]);
    }
    
    let clusters = [];
    let maxIterations = 20;
    
    for (let iter = 0; iter < maxIterations; iter++) {
        // Assign points to nearest centroid
        clusters = Array(k).fill().map(() => []);
        
        for (const point of points) {
            let nearestCentroid = 0;
            let minDistance = euclideanDistance(point, centroids[0]);
            
            for (let j = 1; j < k; j++) {
                const distance = euclideanDistance(point, centroids[j]);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestCentroid = j;
                }
            }
            
            clusters[nearestCentroid].push(point);
        }
        
        // Update centroids
        let changed = false;
        for (let j = 0; j < k; j++) {
            if (clusters[j].length > 0) {
                const newCentroid = calculateCentroid(clusters[j]);
                if (euclideanDistance(newCentroid, centroids[j]) > 0.001) {
                    centroids[j] = newCentroid;
                    changed = true;
                }
            }
        }
        
        if (!changed) break;
    }
    
    return clusters.filter(cluster => cluster.length > 0);
}

function euclideanDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}
