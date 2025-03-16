// Global variables
let currentStep = 1;
const totalSteps = 8;
let isRecording = false;
let stream = null;
let referenceData = [];
let userSkeletonData = null;
let animationFrame = null;
let currentFrameIndex = 0;
let poseDetector = null;
let isPlaying = false;
let selectedParticipant = null;
let participantMetadata = [];

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

// Initialize D3 visualizations
function initializeVisualizations() {
    // Update layout to place visualizations side by side
    const container = document.querySelector('.visualization-container');
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.justifyContent = 'space-between';
    container.style.gap = '20px';
    
    // Set fixed dimensions for visualizations
    const width = 500;  // Fixed width
    const height = 400; // Fixed height
    
    // Create titles and containers for both visualizations
    ['reference', 'user'].forEach(type => {
        const visContainer = document.getElementById(`${type}-vis`);
        visContainer.style.flex = '1';
        visContainer.style.minWidth = `${width}px`;
        visContainer.style.display = 'flex';
        visContainer.style.flexDirection = 'column';
        visContainer.style.alignItems = 'center';
        
        // Add title
        const title = document.createElement('h3');
        // title.textContent = type === 'reference' ? 'Reference Movement' : 'Your Movement';
        title.style.textAlign = 'center';
        title.style.marginBottom = '15px';
        title.style.color = '#3498db';
        visContainer.appendChild(title);
        
        const svg = d3.select(`#${type}-vis`)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .style('display', 'block')
            .style('margin', '0 auto');
            
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
    
    const frameDelay = 20; // 100ms delay between frames (10 frames per second)
    let lastFrameTime = 0;
    
    function animate(currentTime) {
        if (!lastFrameTime) lastFrameTime = currentTime;
        
        const elapsed = currentTime - lastFrameTime;
        
        if (elapsed > frameDelay) {
            updateVisualization(currentFrameIndex);
            currentFrameIndex = (currentFrameIndex + 1) % referenceData.length;
            lastFrameTime = currentTime;
        }
        
        if (isPlaying) {
            animationFrame = requestAnimationFrame(animate);
        }
    }
    
    animate(0);
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
    
    const scale = 0.6 * Math.min(
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
    
    // Use selected participant's measurements
    const measurements = selectedParticipant ? {
        height: parseFloat(selectedParticipant['Body height (m)']),
        shoulderWidth: parseFloat(selectedParticipant['Shoulder Width']),
        armSpan: parseFloat(selectedParticipant['Arm Span']),
        hipWidth: parseFloat(selectedParticipant['Hip Width']),
        kneeHeight: parseFloat(selectedParticipant['Knee Height']),
        ankleHeight: parseFloat(selectedParticipant['Ankle Height'])
    } : {
        height: 1.8,
        shoulderWidth: 0.31,
        armSpan: 1.74,
        hipWidth: 0.27,
        kneeHeight: 0.53,
        ankleHeight: 0.1
    };

    // Calculate scaling factors based on measurements
    const heightScale = measurements.height / 2;
    const shoulderScale = measurements.shoulderWidth / 0.4;
    const hipScale = measurements.hipWidth / 0.3;
    
    // Use the average of the scaling factors
    const measurementScale = (heightScale + shoulderScale + hipScale) / 3;
    
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
    // If trying to go to next step without selecting a participant, prevent it
    if (direction > 0 && !selectedParticipant) {
        alert('Please select a matching participant first');
        return;
    }

    const prevStep = currentStep;
    currentStep = Math.max(1, Math.min(totalSteps, currentStep + direction));
    
    // Update button states
    document.getElementById('back-btn').disabled = currentStep === 1;
    document.getElementById('next-btn').disabled = currentStep === totalSteps || (currentStep === 1 && !selectedParticipant);
    
    // Update step visibility
    document.getElementById(`step${prevStep}`).style.display = 'none';
    document.getElementById(`step${currentStep}`).style.display = 'block';
    
    // Handle visualization and try-it button based on step
    const tryItBtn = document.getElementById('try-it-btn');
    const visualizationContainer = document.querySelector('.visualization-container');
    const participantForm = document.getElementById('participant-selection');
    const mainContent = document.querySelector('.main-content');
    
    if (currentStep === 1) {
        // First page: show participant form, hide everything else
        tryItBtn.style.display = 'none';
        mainContent.style.display = 'none';
        participantForm.style.display = 'block';
        participantForm.style.opacity = '1';
        
        // Stop camera if recording
        if (isRecording) {
            stopCamera();
        }
        
        // Stop animation if playing
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            isPlaying = false;
        }
        
        // Reset visualization container state
        visualizationContainer.style.justifyContent = 'space-between';
        document.getElementById('reference-vis').style.display = 'none';
        document.getElementById('user-vis').style.display = 'none';
    } else if (currentStep === 8) {
        // Last page: hide everything except step 8 content
        tryItBtn.style.display = 'none';
        mainContent.style.display = 'none';
        participantForm.style.display = 'none';
        
        // Stop camera if recording
        if (isRecording) {
            stopCamera();
        }
        
        // Stop animation if playing
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            isPlaying = false;
        }
        
        // Reset visualization container state
        visualizationContainer.style.display = 'none';
        document.getElementById('reference-vis').style.display = 'none';
        document.getElementById('user-vis').style.display = 'none';
    } else {
        // Other pages (2-7): show visualization, try-it button, and main content
        tryItBtn.style.display = 'inline-block';
        mainContent.style.display = 'flex';
        visualizationContainer.style.display = 'flex';
        participantForm.style.display = 'none';
        
        // Show reference visualization
        document.getElementById('reference-vis').style.display = 'flex';
        
        // Initialize visualization if not already done
        if (!document.querySelector('#reference-vis svg')) {
            initializeVisualizations();
            updateVisualization(currentFrameIndex);
        }
        
        // Start camera for steps 2-7 if not already recording
        if (!isRecording) {
            toggleCamera();
        }
    }
    
    // Update visualization focus
    if (currentStep > 1 && currentStep < 8) {
        updateVisualization(currentFrameIndex);
    }
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
    
    // Hide camera container
    document.querySelector('.camera-container').style.display = 'none';
    
    // Center the reference visualization
    const visualizationContainer = document.querySelector('.visualization-container');
    visualizationContainer.style.display = 'flex';
    visualizationContainer.style.justifyContent = 'center';
    visualizationContainer.style.alignItems = 'center';
    
    // Ensure reference visualization is centered
    const referenceVis = document.getElementById('reference-vis');
    referenceVis.style.display = 'flex';
    referenceVis.style.flexDirection = 'column';
    referenceVis.style.alignItems = 'center';
    
    document.getElementById('try-it-btn').textContent = 'Try It!';
    isRecording = false;
    
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
    const color = '#e74c3c';
    
    // Draw pose connections (excluding face)
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
    
    // Draw landmarks (excluding face landmarks 0-10)
    landmarks.forEach((landmark, index) => {
        // Skip facial landmarks (indices 0-10)
        if (index <= 10) return;
        
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
    
    // Get video dimensions for proper scaling
    const videoElement = document.getElementById('camera-feed');
    const videoWidth = videoElement.videoWidth || videoElement.width;
    const videoHeight = videoElement.videoHeight || videoElement.height;
    
    // Convert landmarks to our format with proper scaling
    Object.entries(mapping).forEach(([index, jointName]) => {
        const landmark = landmarks[index];
        if (landmark.visibility > 0.5) {
            // Scale coordinates to match our visualization space
            // MediaPipe gives coordinates in [0,1] range, we need to scale them appropriately
            skeleton[`${jointName}_x`] = landmark.x;
            // Flip Y coordinate since MediaPipe uses top-left origin and we use bottom-left
            skeleton[`${jointName}_y`] = 1 - landmark.y;
        }
    });
    
    // Add derived points with proper scaling
    // Neck - midpoint between shoulders
    if (skeleton['left_shoulder_x'] && skeleton['right_shoulder_x']) {
        skeleton['neck_x'] = (skeleton['left_shoulder_x'] + skeleton['right_shoulder_x']) / 2;
        skeleton['neck_y'] = (skeleton['left_shoulder_y'] + skeleton['right_shoulder_y']) / 2 + 0.05; // Adjust neck position up slightly
    }
    
    // Pelvis - midpoint between hips with adjusted height
    if (skeleton['left_upper_leg_x'] && skeleton['right_upper_leg_x']) {
        skeleton['pelvis_x'] = (skeleton['left_upper_leg_x'] + skeleton['right_upper_leg_x']) / 2;
        skeleton['pelvis_y'] = (skeleton['left_upper_leg_y'] + skeleton['right_upper_leg_y']) / 2;
    }
    
    // Spine points with adjusted spacing
    if (skeleton['neck_x'] && skeleton['pelvis_x']) {
        const spinePoints = ['t8', 't12', 'l3', 'l5'];
        const totalPoints = spinePoints.length + 1;
        const spineLength = skeleton['neck_y'] - skeleton['pelvis_y'];
        
        spinePoints.forEach((joint, index) => {
            const ratio = (index + 1) / totalPoints;
            // Use linear interpolation for X coordinates
            skeleton[`${joint}_x`] = skeleton['neck_x'] * (1 - ratio) + skeleton['pelvis_x'] * ratio;
            // Use curved interpolation for Y coordinates to create more natural spine curve
            const t = ratio;
            const curveY = t * t * (3 - 2 * t); // Smoothstep interpolation for more natural curve
            skeleton[`${joint}_y`] = skeleton['neck_y'] - (spineLength * curveY);
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
    playBtn.textContent = 'Play';
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
        playBtn.textContent = 'Pause';
    } else {
        // Pause animation
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        playBtn.textContent = 'Play';
    }
}

// Event listeners
document.getElementById('back-btn').addEventListener('click', () => updateStep(-1));
document.getElementById('next-btn').addEventListener('click', () => updateStep(1));
document.getElementById('try-it-btn').addEventListener('click', toggleCamera);

// Add window load event to ensure DOM is fully loaded
window.addEventListener('load', () => {
    // Load participant metadata first
    loadParticipantMetadata();
    
    // Initialize participant selection form
    initializeParticipantSelection();
    
    // Create playback controls (they'll be hidden initially)
    createPlaybackControls();
    
    // Initialize first page
    const tryItBtn = document.getElementById('try-it-btn');
    tryItBtn.style.display = 'none';
    document.getElementById('back-btn').disabled = true;
    document.getElementById('next-btn').disabled = true;
    
    // Hide visualization container initially
    document.querySelector('.visualization-container').style.display = 'none';
    
    // Ensure participant selection is visible on first load
    const participantForm = document.getElementById('participant-selection');
    if (participantForm) {
        participantForm.style.display = 'block';
        participantForm.style.opacity = '1';
    }
    
    // Initialize
    updateStep(0);
});

// Conversion functions
function inchesToMeters(inches) {
    return inches * 0.0254; // 1 inch = 0.0254 meters
}

function poundsToKilograms(pounds) {
    return pounds * 0.45359237; // 1 pound = 0.45359237 kilograms
}

// Function to find closest participant based on gender, weight and height
function findClosestParticipant(gender, weightLbs, heightInches) {
    let closestParticipant = null;
    let minDiff = Infinity;

    // Convert to metric
    const weightKg = poundsToKilograms(weightLbs);
    const heightM = inchesToMeters(heightInches);

    participantMetadata.forEach(participant => {
        if (participant.Gender === gender) {
            const weightDiff = Math.abs(participant['Body mass (kg)'] - weightKg);
            const heightDiff = Math.abs(participant['Body height (m)'] - heightM);
            // Normalize differences since weight and height are in different scales
            const normalizedDiff = (weightDiff / 20) + (heightDiff / 0.2); // Normalize to similar scales
            
            if (normalizedDiff < minDiff) {
                minDiff = normalizedDiff;
                closestParticipant = participant;
            }
        }
    });

    return closestParticipant;
}

// Conversion functions for display (metric to US)
function metersToInches(meters) {
    return Math.round(meters * 39.3701); // 1 meter = 39.3701 inches
}

function kilogramsToPounds(kg) {
    return Math.round(kg * 2.20462); // 1 kg = 2.20462 pounds
}

function formatParticipantInfo(participant) {
    const heightInches = metersToInches(parseFloat(participant['Body height (m)']));
    const heightFeet = Math.floor(heightInches / 12);
    const remainingInches = heightInches % 12;
    const weightLbs = kilogramsToPounds(parseFloat(participant['Body mass (kg)']));
    
    return `
        <div class="participant-info">
            <h3>Matched Participant Details:</h3>
            <ul>
                <li><strong>Height:</strong> ${heightFeet}'${remainingInches}" (${participant['Body height (m)']}m)</li>
                <li><strong>Weight:</strong> ${weightLbs} lbs (${participant['Body mass (kg)']}kg)</li>
                <li><strong>Gender:</strong> ${participant.Gender === 'M' ? 'Male' : 'Female'}</li>
                <li><strong>Shoulder Width:</strong> ${participant['Shoulder Width']}m</li>
                <li><strong>Arm Span:</strong> ${participant['Arm Span']}m</li>
                <li><strong>Hip Width:</strong> ${participant['Hip Width']}m</li>
                <li><strong>Knee Height:</strong> ${participant['Knee Height']}m</li>
                <li><strong>Ankle Height:</strong> ${participant['Ankle Height']}m</li>
            </ul>
        </div>
    `;
}

// Remove the createParticipantSelectionUI function and replace with a function to initialize the form
function initializeParticipantSelection() {
    const genderSelect = document.getElementById('gender-select');
    const weightInput = document.getElementById('weight-input');
    const heightInput = document.getElementById('height-input');
    const findMatchBtn = document.getElementById('find-match-btn');
    const participantForm = document.getElementById('participant-selection');
    
    // Add consistent styling to form elements
    const formElements = [genderSelect, weightInput, heightInput, findMatchBtn];
    formElements.forEach(element => {
        element.style.cssText = `
            width: 100%;
            height: 45px;
            padding: 0 15px;
            font-size: 16px;
            border-radius: 8px;
            border: 2px solid #e0e0e0;
            background-color: white;
            transition: all 0.3s ease;
            box-sizing: border-box;
            margin-bottom: 15px;
        `;
    });

    // Special styles for the button
    findMatchBtn.style.cssText += `
        background-color: #3498db;
        color: white;
        border: none;
        font-weight: 600;
        cursor: pointer;
    `;

    // Add hover effects
    findMatchBtn.onmouseover = () => {
        findMatchBtn.style.backgroundColor = '#2980b9';
        findMatchBtn.style.transform = 'translateY(-1px)';
    };
    findMatchBtn.onmouseout = () => {
        findMatchBtn.style.backgroundColor = '#3498db';
        findMatchBtn.style.transform = 'translateY(0)';
    };

    // Add focus styles for input and select
    [genderSelect, weightInput, heightInput].forEach(element => {
        element.onfocus = () => {
            element.style.borderColor = '#3498db';
            element.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
        };
        element.onblur = () => {
            element.style.borderColor = '#e0e0e0';
            element.style.boxShadow = 'none';
        };
    });

    function next(genderSelect,  weightInput, heightInput) {
        const gender = genderSelect.value;
        const weightLbs = parseFloat(weightInput.value);
        const heightInches = parseFloat(heightInput.value);
        
        if (!gender || isNaN(weightLbs) || isNaN(heightInches)) {
            alert('Please select gender and enter valid weight and height values');
            return;
        }

        if (weightLbs <= 0 || heightInches <= 0) {
            alert('Weight and height must be positive values');
            return;
        }

        // Reasonable ranges for height in inches (36" to 96" = 3' to 8')
        if (heightInches < 36 || heightInches > 96) {
            alert('Please enter a reasonable height in inches (36" to 96")');
            return;
        }

        // Reasonable range for weight in pounds (50 to 500 lbs)
        if (weightLbs < 50 || weightLbs > 500) {
            alert('Please enter a reasonable weight in pounds (50 to 500 lbs)');
            return;
        }

        selectedParticipant = findClosestParticipant(gender, weightLbs, heightInches);
        if (selectedParticipant) {
            loadParticipantData(selectedParticipant['Participant ID']);
            // Just enable the next button, don't show visualization yet
            document.getElementById('next-btn').disabled = false;
            
            // Create success message with participant info
            const successMsg = document.createElement('div');
            successMsg.className = 'success-message intro-next';
            successMsg.innerHTML = `
                <p>Participant matched successfully!</p>
                <p class="intro-next">
                            You have been matched! You will now see how your body moves in real-time,
                            compared to optimal movement patterns from our database of 14 healthy patients. Click Next to begin your
                            step-by-step analysis, where you will be able to compare your 
                            movement with the reference model using your camera.
                        </p>
                ${formatParticipantInfo(selectedParticipant)}
                <p class="next-prompt">Click Next to continue.</p>
            `;
            
            // Add styles for the success message
            successMsg.style.cssText = `
                font-size: 1.1rem;
                color: #2c3e50;
                padding: 20px;
                background-color: rgba(46, 204, 113, 0.1);
                border-radius: 8px;
                margin-top: 20px;
            `;
            
            // Add styles for the participant info
            const style = document.createElement('style');
            style.textContent = `
                .participant-info {
                    margin: 15px 0;
                    padding: 15px;
                    background-color: rgba(255, 255, 255, 0.7);
                    border-radius: 6px;
                }
                .participant-info h3 {
                    margin: 0 0 10px 0;
                    color: #2c3e50;
                    font-size: 1.1rem;
                }
                .participant-info ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .participant-info li {
                    margin: 8px 0;
                    font-size: 0.95rem;
                }
                .participant-info strong {
                    color: #2980b9;
                }
                .next-prompt {
                    margin-top: 15px;
                    font-weight: 600;
                    color: #27ae60;
                }
            `;
            document.head.appendChild(style);
            
            // Remove any existing success message
            const existingMsg = participantForm.querySelector('.success-message');
            if (existingMsg) {
                existingMsg.remove();
            }
            
            participantForm.appendChild(successMsg);
            findMatchBtn.style.display = 'none';
        } else {
            alert('No matching participant found. Please try different criteria.');
        }
    }
    weightInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            next(genderSelect,  weightInput, weightInput);
        }
    });
    heightInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            next(genderSelect,  weightInput, heightInput);
        }
    });
    findMatchBtn.addEventListener('click', () => {
        next(genderSelect,  weightInput, heightInput);
    });
}

// Function to load participant data
async function loadParticipantData(participantId) {
    try {
        // Load reference data for the selected participant
        const data = await d3.csv(`${participantId}.csv`);
        if (!data || data.length === 0) {
            throw new Error('No data loaded');
        }
        referenceData = data;
        console.log(`Reference data loaded for ${participantId}: ${data.length} frames`);
        
        // Don't initialize visualizations yet - wait for step 2
        document.getElementById('next-btn').disabled = false;
    } catch (error) {
        console.error('Error loading reference data:', error);
        alert(`Error loading participant data: ${error.message}. Please make sure the file ${participantId}.csv exists and try again.`);
    }
}

// Modify the loadParticipantMetadata function
async function loadParticipantMetadata() {
    try {
        const data = await d3.csv('subject_metadata.csv');
        participantMetadata = data;
    } catch (error) {
        console.error('Error loading participant metadata:', error);
        alert('Error loading participant metadata. Please try again.');
    }
}
