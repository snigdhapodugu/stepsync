// Global variables
let currentStep = 1;
const totalSteps = 7;
let isRecording = false;
let stream = null;
let referenceData = [];
let userSkeletonData = null;
let animationFrame = null;
let currentFrameIndex = 0;
let poseDetector = null;
let isPlaying = false;

// Global variables for OpenCV processing
let lastFrame = null;
let lastValidPose = null;
let motionHistory = [];
const MOTION_HISTORY_SIZE = 5;

// Skeleton connections (pairs of joints that should be connected)
const connections = [
    ['head', 'neck'],
    ['neck', 't8'],
    ['t8', 't12'],
    ['t12', 'l3'],
    ['l3', 'l5'],
    ['l5', 'pelvis'],
    ['neck', 'right_shoulder'],
    ['right_shoulder', 'right_upper_arm'],
    ['right_upper_arm', 'right_forearm'],
    ['right_forearm', 'right_hand'],
    ['neck', 'left_shoulder'],
    ['left_shoulder', 'left_upper_arm'],
    ['left_upper_arm', 'left_forearm'],
    ['left_forearm', 'left_hand'],
    ['pelvis', 'right_upper_leg'],
    ['right_upper_leg', 'right_lower_leg'],
    ['right_lower_leg', 'right_foot'],
    ['right_foot', 'right_toe'],
    ['pelvis', 'left_upper_leg'],
    ['left_upper_leg', 'left_lower_leg'],
    ['left_lower_leg', 'left_foot'],
    ['left_foot', 'left_toe']
];

// Focus regions for each step - defines which joints to focus on for each step
const focusRegions = {
    1: null, // Full body for introduction
    2: ['right_foot', 'left_foot', 'right_toe', 'left_toe', 'right_lower_leg', 'left_lower_leg'], // Feet
    3: ['right_upper_leg', 'left_upper_leg', 'right_lower_leg', 'left_lower_leg'], // Knees
    4: ['pelvis', 'l5', 'l3', 'right_upper_leg', 'left_upper_leg'], // Hips
    5: ['t12', 't8', 'l3', 'l5', 'pelvis'], // Core
    6: ['right_shoulder', 'left_shoulder', 'right_upper_arm', 'left_upper_arm', 
        'right_forearm', 'left_forearm', 'right_hand', 'left_hand', 'neck'], // Upper body
    7: null // Full body for balance and coordination
};

// Load reference data
console.log('Loading reference data...');
d3.csv('aligned_skeleton_2d_gait.csv').then(data => {
    referenceData = data;
    console.log(`Reference data loaded: ${data.length} frames`);
    initializeVisualizations();
    updateVisualization(currentFrameIndex);
}).catch(error => {
    console.error('Error loading reference data:', error);
});

// Initialize D3 visualizations
function initializeVisualizations() {
    // Update layout to place visualizations side by side
    const container = document.querySelector('.visualization-container');
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.justifyContent = 'space-between';
    
    const width = document.querySelector('.skeleton-vis').clientWidth;
    const height = document.querySelector('.skeleton-vis').clientHeight;
    
    ['reference', 'user'].forEach(type => {
        const svg = d3.select(`#${type}-vis`)
            .append('svg')
            .attr('width', width)
            .attr('height', height);
            
        svg.append('g')
            .attr('class', 'skeleton')
            .attr('transform', `translate(${width/2}, ${height/2})`);
    });
}

// Animation function
function startAnimation() {
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
    }
    
    function animate() {
        updateVisualization(currentFrameIndex);
        currentFrameIndex = (currentFrameIndex + 1) % referenceData.length;
        if (isPlaying) {
            animationFrame = requestAnimationFrame(animate);
        }
    }
    
    animate();
}

// Update visualization based on current frame and step
function updateVisualization(frameIndex = 0) {
    if (!referenceData.length) return;

    const width = document.querySelector('.skeleton-vis').clientWidth;
    const height = document.querySelector('.skeleton-vis').clientHeight;
    
    // Get current frame data
    const data = referenceData[frameIndex];
    
    // Focus on specific region based on current step
    const focusJoints = focusRegions[currentStep];
    
    // Calculate bounds for visualization
    const bounds = getBounds(data, focusJoints);
    
    // Calculate scale
    const dataWidth = bounds.maxX - bounds.minX;
    const dataHeight = bounds.maxY - bounds.minY;
    
    // Add padding to the bounds
    const padding = focusJoints ? 0.2 : 0.1; // More padding for zoomed views
    
    const scale = 0.7 * Math.min(
        (width * (1 - padding*2)) / dataWidth,
        (height * (1 - padding*2)) / dataHeight
    );
    
    const centerX = -((bounds.maxX + bounds.minX) / 2) * scale;
    const centerY = -((bounds.maxY + bounds.minY) / 2) * scale;
    
    // Update reference visualization
    updateSkeletonVisualization('#reference-vis', data, scale, centerX, centerY, focusJoints);

    // If user data exists, update user visualization
    if (userSkeletonData) {
        updateSkeletonVisualization('#user-vis', userSkeletonData, scale, centerX, centerY, focusJoints);
    }
    
    // Update frame counter display
    document.getElementById('frame-counter').textContent = `Frame ${frameIndex + 1} of ${referenceData.length}`;
}

// Helper function to calculate data bounds
function getBounds(data, focusJoints = null) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    Object.keys(data).forEach(key => {
        if (key.endsWith('_x')) {
            const joint = key.replace('_x', '');
            
            // Skip joints not in focus if we have a focus region
            if (focusJoints && !focusJoints.includes(joint)) {
                return;
            }
            
            const x = parseFloat(data[key]);
            const y = parseFloat(data[key.replace('_x', '_y')]);
            
            if (!isNaN(x) && !isNaN(y)) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    });
    
    // If we didn't find any valid points, or focus region bounds are too small
    // (can happen with single-joint focus), use full skeleton bounds
    if (minX === Infinity || maxX === -Infinity || maxX - minX < 50 || maxY - minY < 50) {
        minX = Infinity, maxX = -Infinity;
        minY = Infinity, maxY = -Infinity;
        
        Object.keys(data).forEach(key => {
            if (key.endsWith('_x')) {
                const x = parseFloat(data[key]);
                const y = parseFloat(data[key.replace('_x', '_y')]);
                
                if (!isNaN(x) && !isNaN(y)) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        });
    }
    
    return { minX, maxX, minY, maxY };
}

// Draw skeleton visualization
function updateSkeletonVisualization(selector, data, scale, centerX, centerY, focusJoints = null) {
    const svg = d3.select(`${selector} svg .skeleton`);
    
    // Clear previous frame
    svg.selectAll('*').remove();
    
    // Draw connections
    connections.forEach(([joint1, joint2]) => {
        // Skip connections not involving focus joints
        if (focusJoints && 
            !focusJoints.includes(joint1) && 
            !focusJoints.includes(joint2)) {
            return;
        }
        
        const x1 = parseFloat(data[`${joint1}_x`]) * scale;
        const y1 = parseFloat(data[`${joint1}_y`]) * scale;
        const x2 = parseFloat(data[`${joint2}_x`]) * scale;
        const y2 = parseFloat(data[`${joint2}_y`]) * scale;
        
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
            return; // Skip invalid data
        }
        
        svg.append('line')
            .attr('x1', x1 + centerX)
            .attr('y1', y1 + centerY)
            .attr('x2', x2 + centerX)
            .attr('y2', y2 + centerY)
            .attr('stroke', '#2c3e50')
            .attr('stroke-width', 2)
            .attr('opacity', getFocusOpacity(joint1, joint2, focusJoints));
    });
    
    // Draw joints
    Object.keys(data).forEach(key => {
        if (key.endsWith('_x')) {
            const joint = key.replace('_x', '');
            const x = parseFloat(data[`${joint}_x`]) * scale;
            const y = parseFloat(data[`${joint}_y`]) * scale;
            
            if (isNaN(x) || isNaN(y)) {
                return; // Skip invalid data
            }
            
            // Skip joints not in focus
            if (focusJoints && !focusJoints.includes(joint)) {
                return;
            }
            
            svg.append('circle')
                .attr('cx', x + centerX)
                .attr('cy', y + centerY)
                .attr('r', joint === 'head' ? 20 : 4)
                .attr('fill', getJointColor(joint, currentStep))
                .attr('stroke', '#333')
                .attr('stroke-width', 1);
                
            // Add joint labels when zoomed in
            if (focusJoints) {
                svg.append('text')
                    .attr('x', x + centerX + 8)
                    .attr('y', y + centerY - 8)
                    .attr('font-size', '10px')
                    .attr('fill', '#333')
                    .text(formatJointName(joint));
            }
        }
    });
}

// Format joint name for display
function formatJointName(joint) {
    return joint.replace(/_/g, ' ');
}

// Get joint color based on current step
function getJointColor(joint, step) {
    const highlightColor = '#e74c3c';
    const defaultColor = '#3498db';
    
    const stepJoints = {
        2: ['right_foot', 'left_foot', 'right_toe', 'left_toe'],
        3: ['right_lower_leg', 'left_lower_leg', 'right_upper_leg', 'left_upper_leg'],
        4: ['pelvis', 'l5', 'l3'],
        5: ['t12', 't8'],
        6: ['right_shoulder', 'left_shoulder', 'right_hand', 'left_hand'],
        7: ['head', 'neck']
    };
    
    return stepJoints[step]?.includes(joint) ? highlightColor : defaultColor;
}

// Determine opacity for connections based on focus
function getFocusOpacity(joint1, joint2, focusJoints) {
    if (!focusJoints) return 1.0;
    
    const isJoint1Focus = focusJoints.includes(joint1);
    const isJoint2Focus = focusJoints.includes(joint2);
    
    if (isJoint1Focus && isJoint2Focus) {
        return 1.0; // Full opacity for connections between focus joints
    } else if (isJoint1Focus || isJoint2Focus) {
        return 0.5; // Medium opacity for connections to one focus joint
    } else {
        return 0.0; // Hide connections not involving focus joints
    }
}

// Handle step navigation
function updateStep(direction) {
    const prevStep = currentStep;
    currentStep = Math.max(1, Math.min(totalSteps, currentStep + direction));
    
    // Update button states
    document.getElementById('back-btn').disabled = currentStep === 1;
    document.getElementById('next-btn').disabled = currentStep === totalSteps;
    
    // Update step visibility
    document.getElementById(`step${prevStep}`).style.display = 'none';
    document.getElementById(`step${currentStep}`).style.display = 'block';
    
    // Handle first page differently
    const tryItBtn = document.getElementById('try-it-btn');
    if (currentStep === 1) {
        tryItBtn.style.display = 'none';
        if (isRecording) {
            stopCamera();
        }
    } else {
        tryItBtn.style.display = 'inline-block';
        // Automatically start camera for steps 2-7 (segments)
        if (!isRecording) {
            toggleCamera();
        }
    }
    
    // Update visualization focus
    updateVisualization(currentFrameIndex);
}

// Camera handling
async function toggleCamera() {
    const cameraContainer = document.querySelector('.camera-container');
    const tryItBtn = document.getElementById('try-it-btn');
    const visualizationContainer = document.querySelector('.visualization-container');
    
    if (!isRecording) {
        try {
            // First check if we have camera permissions
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            
            if (videoDevices.length === 0) {
                throw new Error('No camera devices found');
            }

            // Update layout for camera mode
            visualizationContainer.style.display = 'grid';
            visualizationContainer.style.gridTemplateColumns = '1fr 1fr';
            visualizationContainer.style.gap = '20px';
            visualizationContainer.style.alignItems = 'start';
            
            // Move camera container inside visualization container
            if (cameraContainer.parentElement !== visualizationContainer) {
                visualizationContainer.appendChild(cameraContainer);
            }
            
            cameraContainer.style.display = 'flex';
            
            // Get camera stream with more specific constraints
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user',
                    frameRate: { ideal: 30 }
                },
                audio: false
            });
            
            const videoElement = document.getElementById('camera-feed');
            videoElement.srcObject = stream;
            videoElement.onloadedmetadata = () => {
                videoElement.play();
                cameraContainer.style.gridColumn = '2';
            tryItBtn.textContent = 'Stop Recording';
            isRecording = true;
                
                // Start skeleton tracking only after video is ready
                startSkeletonTracking();
            };
            
        } catch (error) {
            console.error('Error accessing camera:', error);
            let errorMessage = 'Unable to access camera. ';
            
            if (error.name === 'NotAllowedError') {
                errorMessage += 'Please grant camera permissions in your browser settings.';
            } else if (error.name === 'NotFoundError') {
                errorMessage += 'No camera device found. Please make sure your camera is connected.';
            } else if (error.name === 'NotReadableError') {
                errorMessage += 'Camera is in use by another application. Please close other applications using the camera.';
            } else {
                errorMessage += 'Please make sure you have granted camera permissions and no other application is using the camera.';
            }
            
            alert(errorMessage);
        }
    } else {
        stopCamera();
        // Reset layout
        visualizationContainer.style.display = 'flex';
        visualizationContainer.style.flexDirection = 'row';
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    if (poseDetector) {
        poseDetector.dispose();
        poseDetector = null;
    }
    
    document.querySelector('.camera-container').style.display = 'none';
    document.getElementById('try-it-btn').textContent = 'Try It!';
    isRecording = false;
    document.getElementById('user-vis').style.display = 'none';
    
    // Clear canvas overlays
    const canvas = document.getElementById('pose-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Skeleton tracking with MediaPipe and OpenCV
async function startSkeletonTracking() {
    try {
        // Wait for OpenCV to be ready
        if (!window.isOpenCvReady) {
            await new Promise(resolve => {
                window.addEventListener('opencv-ready', resolve, { once: true });
            });
        }

        const videoElement = document.getElementById('camera-feed');
        const cameraContainer = document.querySelector('.camera-container');
        
        let canvas = document.getElementById('pose-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'pose-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            cameraContainer.appendChild(canvas);
        }
        
        // Initialize MediaPipe Pose
        const pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });
        
        // Configure pose detection
        pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        // Setup camera
        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await pose.send({image: videoElement});
            },
            width: 640,
            height: 480
        });
        
        // Handle pose detection results
        pose.onResults((results) => {
            if (results.poseLandmarks) {
                const processedPose = processFrameWithOpenCV(results, videoElement);
                drawPoseOnCanvas(processedPose || results, canvas);
                
                // Convert to our skeleton format and update visualization
                userSkeletonData = convertMediaPipePoseToSkeleton(processedPose || results);
                updateVisualization(currentFrameIndex);
            }
        });
        
        // Start camera
        await camera.start();
        
    } catch (error) {
        console.error('Error initializing pose detector:', error);
        alert('Error initializing pose detection. Please make sure you have a working camera and try again.');
    }
}

// Process frame with OpenCV for improved tracking
function processFrameWithOpenCV(results, videoElement) {
    try {
        // Create OpenCV matrices
        const frame = cv.imread(videoElement);
        
        if (!results.poseLandmarks) {
            if (lastValidPose) {
                results.poseLandmarks = lastValidPose;
            }
            cv.imshow('pose-canvas', frame);
            frame.delete();
            return results;
        }
        
        // Convert landmarks to points for tracking
        const currentPoints = results.poseLandmarks.map(lm => ({
            x: Math.round(lm.x * frame.cols),
            y: Math.round(lm.y * frame.cols),
            visibility: lm.visibility
        }));
        
        if (lastFrame && lastValidPose) {
            // Calculate optical flow for visible points
            const prevPoints = lastValidPose.map(lm => ({
                x: Math.round(lm.x * frame.cols),
                y: Math.round(lm.y * frame.cols)
            }));
            
            // Convert points to OpenCV format
            const prevPointsMat = cv.matFromArray(prevPoints.length, 1, cv.CV_32FC2, 
                prevPoints.flatMap(p => [p.x, p.y]));
            const currPointsMat = cv.matFromArray(currentPoints.length, 1, cv.CV_32FC2,
                currentPoints.flatMap(p => [p.x, p.y]));
            
            // Calculate optical flow
            const status = new cv.Mat();
            const err = new cv.Mat();
            const winSize = new cv.Size(15, 15);
            const maxLevel = 2;
            const criteria = new cv.TermCriteria(
                cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 30, 0.01
            );
            
            cv.calcOpticalFlowPyrLK(lastFrame, frame, prevPointsMat, currPointsMat,
                status, err, winSize, maxLevel, criteria);
            
            // Update points based on optical flow
            for (let i = 0; i < currentPoints.length; i++) {
                if (status.data[i] === 1 && currentPoints[i].visibility > 0.5) {
                    results.poseLandmarks[i].x = currPointsMat.data32F[i * 2] / frame.cols;
                    results.poseLandmarks[i].y = currPointsMat.data32F[i * 2 + 1] / frame.rows;
                }
            }
            
            // Clean up OpenCV matrices
            prevPointsMat.delete();
            currPointsMat.delete();
            status.delete();
            err.delete();
        }
        
        // Update motion history
        motionHistory.push(results.poseLandmarks);
        if (motionHistory.length > MOTION_HISTORY_SIZE) {
            motionHistory.shift();
        }
        
        // Apply temporal smoothing
        if (motionHistory.length === MOTION_HISTORY_SIZE) {
            results.poseLandmarks = results.poseLandmarks.map((landmark, i) => {
                const smoothed = {
                    x: 0,
                    y: 0,
                    z: landmark.z,
                    visibility: landmark.visibility
                };
                
                let totalWeight = 0;
                motionHistory.forEach((hist, idx) => {
                    const weight = (idx + 1) / MOTION_HISTORY_SIZE;
                    smoothed.x += hist[i].x * weight;
                    smoothed.y += hist[i].y * weight;
                    totalWeight += weight;
                });
                
                smoothed.x /= totalWeight;
                smoothed.y /= totalWeight;
                
                return smoothed;
            });
        }
        
        // Update last frame and pose
        if (lastFrame) lastFrame.delete();
        lastFrame = frame.clone();
        lastValidPose = [...results.poseLandmarks];
        
        frame.delete();
        return results;
        
    } catch (error) {
        console.error('Error in OpenCV processing:', error);
        return results;
    }
}

// Draw detected pose on canvas overlay using MediaPipe
function drawPoseOnCanvas(results, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!results || !results.poseLandmarks) return;
    
    const landmarks = results.poseLandmarks;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    // Set up styles - single color for all elements
    const color = '#00ff00';
    
    // Draw pose connections
    const connections = [
        // Torso
        [11, 12], // shoulders
        [11, 23], // left shoulder to hip
        [12, 24], // right shoulder to hip
        [23, 24], // hips
        
        // Arms
        [11, 13], [13, 15], // left arm
        [12, 14], [14, 16], // right arm
        
        // Legs
        [23, 25], [25, 27], [27, 31], // left leg
        [24, 26], [26, 28], [28, 32], // right leg
    ];
    
    // Draw connections with thinner lines
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    connections.forEach(([i, j]) => {
        const point1 = landmarks[i];
        const point2 = landmarks[j];
        
        if (point1.visibility > 0.5 && point2.visibility > 0.5) {
            ctx.moveTo(point1.x * canvasWidth, point1.y * canvasHeight);
            ctx.lineTo(point2.x * canvasWidth, point2.y * canvasHeight);
        }
    });
    ctx.stroke();
    
    // Draw landmarks
    landmarks.forEach((landmark, index) => {
        if (landmark.visibility > 0.5) {
            const x = Math.round(landmark.x * canvasWidth);
            const y = Math.round(landmark.y * canvasHeight);
            
            // Draw smaller points with pixel-perfect circles
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
    });
}

// MediaPipe landmark index to joint name mapping
const mediapipeMap = {
    'head': 0,
    'left_shoulder': 11,
    'right_shoulder': 12,
    'left_elbow': 13,
    'right_elbow': 14,
    'left_wrist': 15,
    'right_wrist': 16,
    'left_hip': 23,
    'right_hip': 24,
    'left_knee': 25,
    'right_knee': 26,
    'left_ankle': 27,
    'right_ankle': 28
};

// Convert MediaPipe pose to our skeleton format
function convertMediaPipePoseToSkeleton(results) {
    const skeleton = {};
    const landmarks = results.poseLandmarks;
    
    // MediaPipe to our format mapping
    const mapping = {
        0: 'head', // nose
        11: 'left_shoulder',
        12: 'right_shoulder',
        13: 'left_upper_arm', // left_elbow
        14: 'right_upper_arm', // right_elbow
        15: 'left_forearm', // left_wrist
        16: 'right_forearm', // right_wrist
        23: 'left_upper_leg', // left_hip
        24: 'right_upper_leg', // right_hip
        25: 'left_lower_leg', // left_knee
        26: 'right_lower_leg', // right_knee
        27: 'left_foot', // left_ankle
        28: 'right_foot' // right_ankle
    };
    
    // Convert landmarks to our format
    Object.entries(mapping).forEach(([index, jointName]) => {
        const landmark = landmarks[index];
        if (landmark.visibility > 0.5) {
            skeleton[`${jointName}_x`] = landmark.x;
            skeleton[`${jointName}_y`] = landmark.y;
        }
    });
    
    // Add derived points (same as before)
    // Neck - midpoint between shoulders
    if (skeleton['left_shoulder_x'] && skeleton['right_shoulder_x']) {
        skeleton['neck_x'] = (skeleton['left_shoulder_x'] + skeleton['right_shoulder_x']) / 2;
        skeleton['neck_y'] = (skeleton['left_shoulder_y'] + skeleton['right_shoulder_y']) / 2 - 0.02;
    }
    
    // Pelvis - midpoint between hips
    if (skeleton['left_upper_leg_x'] && skeleton['right_upper_leg_x']) {
        skeleton['pelvis_x'] = (skeleton['left_upper_leg_x'] + skeleton['right_upper_leg_x']) / 2;
        skeleton['pelvis_y'] = (skeleton['left_upper_leg_y'] + skeleton['right_upper_leg_y']) / 2;
    }
    
    // Spine points
    if (skeleton['neck_x'] && skeleton['pelvis_x']) {
        const spinePoints = ['t8', 't12', 'l3', 'l5'];
        const totalPoints = spinePoints.length + 1;
        
        spinePoints.forEach((joint, index) => {
            const ratio = (index + 1) / totalPoints;
            skeleton[`${joint}_x`] = skeleton['neck_x'] * (1 - ratio) + skeleton['pelvis_x'] * ratio;
            skeleton[`${joint}_y`] = skeleton['neck_y'] * (1 - ratio) + skeleton['pelvis_y'] * ratio;
        });
    }
    
    return skeleton;
}

// Helper function to map our focus joints to MediaPipe indices
function getFocusJointIndices(focusJoints) {
    const mediapipeMap = {
        'head': 0,
        'left_shoulder': 11,
        'right_shoulder': 12,
        'left_upper_arm': 13,
        'right_upper_arm': 14,
        'left_forearm': 15,
        'right_forearm': 16,
        'left_upper_leg': 23,
        'right_upper_leg': 24,
        'left_lower_leg': 25,
        'right_lower_leg': 26,
        'left_foot': 27,
        'right_foot': 28
    };
    
    return focusJoints
        .map(joint => mediapipeMap[joint])
        .filter(index => index !== undefined);
}

// Create a playback control for animation
function createPlaybackControls() {
    const controls = document.createElement('div');
    controls.className = 'playback-controls';
    
    // Play/Pause button
    const playBtn = document.createElement('button');
    playBtn.textContent = '▶️';
    playBtn.id = 'play-pause-btn';
    playBtn.addEventListener('click', togglePlayback);
    
    // Frame counter
    const counter = document.createElement('span');
    counter.id = 'frame-counter';
    counter.textContent = 'Frame 1 of 0';
    counter.style.marginLeft = '10px';
    
    // Add elements to controls
    controls.appendChild(playBtn);
    controls.appendChild(counter);
    
    // Insert controls under reference visualization
    const referenceVis = document.getElementById('reference-vis');
    referenceVis.appendChild(controls);
}

// Toggle playback pause/resume
function togglePlayback() {
    const playBtn = document.getElementById('play-pause-btn');
    
    isPlaying = !isPlaying;
    
    if (isPlaying) {
        // Start animation
        startAnimation();
        playBtn.textContent = '⏸️';
    } else {
        // Pause animation
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        playBtn.textContent = '▶️';
    }
}

// Event listeners
document.getElementById('back-btn').addEventListener('click', () => updateStep(-1));
document.getElementById('next-btn').addEventListener('click', () => updateStep(1));
document.getElementById('try-it-btn').addEventListener('click', toggleCamera);

// Add window load event to ensure DOM is fully loaded
window.addEventListener('load', () => {
    // Create playback controls
    createPlaybackControls();
    
    // Initialize first page
    const tryItBtn = document.getElementById('try-it-btn');
    tryItBtn.style.display = 'none';
    document.getElementById('back-btn').disabled = true;
    
    // Initialize
    updateStep(0);
});